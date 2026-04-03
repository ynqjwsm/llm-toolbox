"""SQLite数据库操作模块"""
import aiosqlite
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional, List
import json

from models import (
    EndpointConfig, EndpointBrief, ModelConfig, ModelBrief,
    ToolConfig, Conversation, Message,
    EndpointType, ToolType
)

DATA_DIR = Path(__file__).parent / "data"
DB_PATH = DATA_DIR / "toolbox.db"
logger = logging.getLogger(__name__)


class DateTimeEncoder(json.JSONEncoder):
    """自定义JSON编码器，处理datetime对象"""
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)


async def init_db():
    """初始化数据库"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    async with aiosqlite.connect(DB_PATH) as db:
        # 端点表
        await db.execute("""
            CREATE TABLE IF NOT EXISTS endpoints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                endpoint_type TEXT NOT NULL,
                api_url TEXT NOT NULL,
                api_key TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # 模型表
        await db.execute("""
            CREATE TABLE IF NOT EXISTS models (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                endpoint_id INTEGER NOT NULL,
                model_name TEXT NOT NULL,
                display_name TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE,
                UNIQUE(endpoint_id, model_name)
            )
        """)

        # 工具表
        await db.execute("""
            CREATE TABLE IF NOT EXISTS tools (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                tool_type TEXT NOT NULL,
                model_id INTEGER NOT NULL,
                system_prompt TEXT DEFAULT '',
                description TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
            )
        """)

        # 对话表
        await db.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tool_id INTEGER NOT NULL,
                title TEXT,
                messages TEXT DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
            )
        """)

        # 数据库迁移：检查models表是否有endpoint_id列
        cursor = await db.execute("PRAGMA table_info(models)")
        columns = [row[1] for row in await cursor.fetchall()]

        if 'endpoint_id' not in columns:
            # 旧表结构需要迁移：备份旧数据、删除旧表、重建新表
            logger.info("检测到旧版本models表，开始迁移...")

            # 获取旧模型数据（如果有）
            old_models = []
            try:
                cursor = await db.execute("SELECT id, model_name, display_name, created_at FROM models")
                old_models = await cursor.fetchall()
            except:
                pass

            # 删除关联的tools和conversations表（因为模型结构变了）
            await db.execute("DROP TABLE IF EXISTS conversations")
            await db.execute("DROP TABLE IF EXISTS tools")
            await db.execute("DROP TABLE IF EXISTS models")

            # 重建新表结构
            await db.execute("""
                CREATE TABLE models (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    endpoint_id INTEGER NOT NULL,
                    model_name TEXT NOT NULL,
                    display_name TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE,
                    UNIQUE(endpoint_id, model_name)
                )
            """)

            await db.execute("""
                CREATE TABLE tools (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    tool_type TEXT NOT NULL,
                    model_id INTEGER NOT NULL,
                    system_prompt TEXT DEFAULT '',
                    description TEXT DEFAULT '',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
                )
            """)

            await db.execute("""
                CREATE TABLE conversations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tool_id INTEGER NOT NULL,
                    title TEXT,
                    messages TEXT DEFAULT '[]',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
                )
            """)

            logger.info(f"数据库迁移完成，旧模型数据已清空")

        await db.commit()


# ========== 端点 CRUD ==========

async def get_endpoints() -> List[EndpointBrief]:
    """获取所有端点列表（含模型数量）"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT e.id, e.name, e.endpoint_type, e.api_url, COUNT(m.id) as model_count
            FROM endpoints e
            LEFT JOIN models m ON e.id = m.endpoint_id
            GROUP BY e.id
            ORDER BY e.created_at DESC
        """)
        rows = await cursor.fetchall()
        return [EndpointBrief(
            id=row["id"],
            name=row["name"],
            endpoint_type=EndpointType(row["endpoint_type"]),
            api_url=row["api_url"],
            model_count=row["model_count"]
        ) for row in rows]


async def get_endpoint(id: int) -> Optional[EndpointConfig]:
    """获取单个端点配置"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM endpoints WHERE id = ?", (id,))
        row = await cursor.fetchone()
        if row:
            return EndpointConfig(
                id=row["id"],
                name=row["name"],
                endpoint_type=EndpointType(row["endpoint_type"]),
                api_url=row["api_url"],
                api_key=row["api_key"],
                created_at=row["created_at"],
                updated_at=row["updated_at"]
            )
        return None


async def create_endpoint(endpoint: EndpointConfig) -> EndpointConfig:
    """创建端点"""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """INSERT INTO endpoints (name, endpoint_type, api_url, api_key)
               VALUES (?, ?, ?, ?)""",
            (endpoint.name, endpoint.endpoint_type.value, endpoint.api_url, endpoint.api_key)
        )
        endpoint.id = cursor.lastrowid
        await db.commit()
        return endpoint


async def update_endpoint(id: int, endpoint: EndpointConfig) -> Optional[EndpointConfig]:
    """更新端点"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """UPDATE endpoints SET name=?, endpoint_type=?, api_url=?, api_key=?, updated_at=CURRENT_TIMESTAMP
               WHERE id=?""",
            (endpoint.name, endpoint.endpoint_type.value, endpoint.api_url, endpoint.api_key, id)
        )
        await db.commit()
        return await get_endpoint(id)


async def delete_endpoint(id: int) -> bool:
    """删除端点（关联的模型也会被删除）"""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("DELETE FROM endpoints WHERE id = ?", (id,))
        await db.commit()
        return cursor.rowcount > 0


# ========== 模型 CRUD ==========

async def get_models() -> List[ModelBrief]:
    """获取所有模型列表（含端点信息）"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT m.id, m.endpoint_id, m.model_name, m.display_name,
                   e.name as endpoint_name, e.endpoint_type
            FROM models m
            JOIN endpoints e ON m.endpoint_id = e.id
            ORDER BY e.name, m.model_name
        """)
        rows = await cursor.fetchall()
        return [ModelBrief(
            id=row["id"],
            endpoint_id=row["endpoint_id"],
            endpoint_name=row["endpoint_name"],
            endpoint_type=EndpointType(row["endpoint_type"]),
            model_name=row["model_name"],
            display_name=row["display_name"]
        ) for row in rows]


async def get_models_by_endpoint(endpoint_id: int) -> List[ModelConfig]:
    """获取指定端点的模型列表"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM models WHERE endpoint_id = ? ORDER BY model_name",
            (endpoint_id,)
        )
        rows = await cursor.fetchall()
        return [ModelConfig(
            id=row["id"],
            endpoint_id=row["endpoint_id"],
            model_name=row["model_name"],
            display_name=row["display_name"],
            created_at=row["created_at"],
            updated_at=row["updated_at"]
        ) for row in rows]


async def get_model(id: int) -> Optional[ModelBrief]:
    """获取单个模型（含端点信息）"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT m.id, m.endpoint_id, m.model_name, m.display_name,
                   e.name as endpoint_name, e.endpoint_type, e.api_url, e.api_key
            FROM models m
            JOIN endpoints e ON m.endpoint_id = e.id
            WHERE m.id = ?
        """, (id,))
        row = await cursor.fetchone()
        if row:
            return ModelBrief(
                id=row["id"],
                endpoint_id=row["endpoint_id"],
                endpoint_name=row["endpoint_name"],
                endpoint_type=EndpointType(row["endpoint_type"]),
                model_name=row["model_name"],
                display_name=row["display_name"]
            )
        return None


async def get_model_with_endpoint(id: int) -> Optional[dict]:
    """获取模型及其端点完整信息（用于LLM调用）"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT m.id, m.model_name, m.display_name,
                   e.id as endpoint_id, e.name as endpoint_name, e.endpoint_type,
                   e.api_url, e.api_key
            FROM models m
            JOIN endpoints e ON m.endpoint_id = e.id
            WHERE m.id = ?
        """, (id,))
        row = await cursor.fetchone()
        if row:
            return {
                "id": row["id"],
                "model_name": row["model_name"],
                "display_name": row["display_name"],
                "endpoint_id": row["endpoint_id"],
                "endpoint_name": row["endpoint_name"],
                "endpoint_type": row["endpoint_type"],
                "api_url": row["api_url"],
                "api_key": row["api_key"]
            }
        return None


async def create_model(model: ModelConfig) -> Optional[ModelConfig]:
    """创建模型"""
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            cursor = await db.execute(
                """INSERT INTO models (endpoint_id, model_name, display_name)
                   VALUES (?, ?, ?)""",
                (model.endpoint_id, model.model_name, model.display_name)
            )
            model.id = cursor.lastrowid
            await db.commit()
            return model
    except aiosqlite.IntegrityError:
        # 模型已存在
        return None


async def update_model(id: int, model: ModelConfig) -> Optional[ModelConfig]:
    """更新模型"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """UPDATE models SET endpoint_id=?, model_name=?, display_name=?, updated_at=CURRENT_TIMESTAMP
               WHERE id=?""",
            (model.endpoint_id, model.model_name, model.display_name, id)
        )
        await db.commit()
        return await get_model(id)


async def delete_model(id: int) -> bool:
    """删除模型"""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("DELETE FROM models WHERE id = ?", (id,))
        await db.commit()
        return cursor.rowcount > 0


async def create_models_batch(endpoint_id: int, model_names: List[str]) -> int:
    """批量创建模型"""
    count = 0
    async with aiosqlite.connect(DB_PATH) as db:
        for name in model_names:
            cursor = await db.execute(
                """INSERT OR IGNORE INTO models (endpoint_id, model_name)
                   VALUES (?, ?)""",
                (endpoint_id, name)
            )
            if cursor.rowcount > 0:
                count += 1
        await db.commit()
    return count


# ========== 工具 CRUD ==========

async def get_tools() -> List[ToolConfig]:
    """获取所有工具配置"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM tools ORDER BY created_at DESC")
        rows = await cursor.fetchall()
        return [ToolConfig(
            id=row["id"],
            name=row["name"],
            tool_type=ToolType(row["tool_type"]),
            model_id=row["model_id"],
            system_prompt=row["system_prompt"],
            description=row["description"],
            created_at=row["created_at"],
            updated_at=row["updated_at"]
        ) for row in rows]


async def get_tool(id: int) -> Optional[ToolConfig]:
    """获取单个工具配置"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM tools WHERE id = ?", (id,))
        row = await cursor.fetchone()
        if row:
            return ToolConfig(
                id=row["id"],
                name=row["name"],
                tool_type=ToolType(row["tool_type"]),
                model_id=row["model_id"],
                system_prompt=row["system_prompt"],
                description=row["description"],
                created_at=row["created_at"],
                updated_at=row["updated_at"]
            )
        return None


async def create_tool(tool: ToolConfig) -> ToolConfig:
    """创建工具配置"""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """INSERT INTO tools (name, tool_type, model_id, system_prompt, description)
               VALUES (?, ?, ?, ?, ?)""",
            (tool.name, tool.tool_type.value, tool.model_id, tool.system_prompt or "", tool.description or "")
        )
        tool.id = cursor.lastrowid
        await db.commit()
        return tool


async def update_tool(id: int, tool: ToolConfig) -> Optional[ToolConfig]:
    """更新工具配置"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """UPDATE tools SET name=?, tool_type=?, model_id=?, system_prompt=?, description=?, updated_at=CURRENT_TIMESTAMP
               WHERE id=?""",
            (tool.name, tool.tool_type.value, tool.model_id, tool.system_prompt or "", tool.description or "", id)
        )
        await db.commit()
        return await get_tool(id)


async def delete_tool(id: int) -> bool:
    """删除工具配置"""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("DELETE FROM tools WHERE id = ?", (id,))
        await db.commit()
        return cursor.rowcount > 0


# ========== 对话 CRUD ==========

async def get_conversations(tool_id: Optional[int] = None) -> List[Conversation]:
    """获取对话列表"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if tool_id:
            cursor = await db.execute(
                "SELECT * FROM conversations WHERE tool_id = ? ORDER BY updated_at DESC",
                (tool_id,)
            )
        else:
            cursor = await db.execute("SELECT * FROM conversations ORDER BY updated_at DESC")
        rows = await cursor.fetchall()
        result = []
        for row in rows:
            raw_messages = json.loads(row["messages"])
            messages = [Message(**msg) if isinstance(msg, dict) else msg for msg in raw_messages]
            result.append(Conversation(
                id=row["id"],
                tool_id=row["tool_id"],
                title=row["title"],
                messages=messages,
                created_at=row["created_at"],
                updated_at=row["updated_at"]
            ))
        return result


async def get_conversation(id: int) -> Optional[Conversation]:
    """获取单个对话"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM conversations WHERE id = ?", (id,))
        row = await cursor.fetchone()
        if row:
            raw_messages = json.loads(row["messages"])
            # 将dict转换为Message对象
            messages = [Message(**msg) if isinstance(msg, dict) else msg for msg in raw_messages]
            return Conversation(
                id=row["id"],
                tool_id=row["tool_id"],
                title=row["title"],
                messages=messages,
                created_at=row["created_at"],
                updated_at=row["updated_at"]
            )
        return None


async def create_conversation(tool_id: int, title: Optional[str] = None) -> Conversation:
    """创建新对话"""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO conversations (tool_id, title, messages) VALUES (?, ?, '[]')",
            (tool_id, title or "新对话")
        )
        await db.commit()
        return Conversation(id=cursor.lastrowid, tool_id=tool_id, title=title or "新对话", messages=[])


async def add_message(conversation_id: int, message: Message) -> Optional[Conversation]:
    """添加消息到对话"""
    conv = await get_conversation(conversation_id)
    if not conv:
        return None

    message.created_at = datetime.now()
    conv.messages.append(message)

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """UPDATE conversations SET messages=?, updated_at=CURRENT_TIMESTAMP
               WHERE id=?""",
            (json.dumps([m.model_dump() for m in conv.messages], cls=DateTimeEncoder), conversation_id)
        )
        await db.commit()

    return conv


async def delete_conversation(id: int) -> bool:
    """删除对话"""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("DELETE FROM conversations WHERE id = ?", (id,))
        await db.commit()
        return cursor.rowcount > 0


async def update_messages(conversation_id: int, messages: List[Message]) -> Optional[Conversation]:
    """更新对话的消息列表"""
    conv = await get_conversation(conversation_id)
    if not conv:
        return None

    conv.messages = messages

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """UPDATE conversations SET messages=?, updated_at=CURRENT_TIMESTAMP
               WHERE id=?""",
            (json.dumps([m.model_dump() for m in conv.messages], cls=DateTimeEncoder), conversation_id)
        )
        await db.commit()

    return conv