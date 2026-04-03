FROM python:3.14-slim

LABEL maintainer="llm-toolbox"

# 环境变量
ENV APP_HOST=0.0.0.0 \
    APP_PORT=8000 \
    APP_RELOAD=false \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# 安装系统依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg curl && \
    curl -LsSf https://astral.sh/uv/install.sh | sh && \
    rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.local/bin:$PATH"

COPY pyproject.toml uv.lock* ./

RUN uv pip install --system .

# 复制项目代码
COPY main.py models.py database.py ./
COPY llm/ llm/
COPY html/ html/

# 创建数据目录（可挂载外部volume）
RUN mkdir -p /app/data

# 暴露端口
EXPOSE ${APP_PORT}

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${APP_PORT}/')" || exit 1

CMD ["python", "main.py"]
