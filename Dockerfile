FROM python:3.13-slim

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
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# 安装Python依赖
RUN pip install --no-cache-dir \
    "fastapi[standard]>=0.115.0" \
    pydantic>=2.0.0 \
    jinja2>=3.1.2 \
    aiosqlite>=0.20.0 \
    httpx>=0.27.0

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
