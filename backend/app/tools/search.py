import httpx
import json
import redis
from app.config import settings, get_db_config


class SearchTool:
    """联网搜索工具 - Serper API（动态读配置）"""

    def __init__(self):
        self.base_url = "https://google.serper.dev/search"
        self._redis = None

    def _get_api_key(self) -> str:
        """动态获取 API Key（环境变量 > 数据库）"""
        db_config = get_db_config()
        return db_config.get("SERPER_API_KEY") or settings.SERPER_API_KEY or ""

    @property
    def redis_client(self):
        if self._redis is None:
            self._redis = redis.from_url(settings.REDIS_URL, decode_responses=True)
        return self._redis

    def _cache_key(self, query: str) -> str:
        return f"search:{hash(query)}"

    async def search(self, query: str) -> list[dict]:
        """执行搜索，返回结果列表"""
        # Check cache first
        cache_key = self._cache_key(query)
        cached = self.redis_client.get(cache_key)
        if cached:
            return json.loads(cached)

        api_key = self._get_api_key()
        if not api_key:
            return [{"title": "搜索不可用 - 未配置 Serper API Key", "snippet": "", "link": ""}]

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                self.base_url,
                headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
                json={"q": query, "gl": "cn", "hl": "zh-cn", "num": 5},
            )
            resp.raise_for_status()
            data = resp.json()

        results = []
        for item in data.get("organic", []):
            results.append({
                "title": item.get("title", ""),
                "snippet": item.get("snippet", ""),
                "link": item.get("link", ""),
            })

        # Cache for 24h
        self.redis_client.setex(cache_key, 86400, json.dumps(results, ensure_ascii=False))
        return results

    async def search_multiple(self, queries: list[str]) -> list[dict]:
        """批量搜索"""
        all_results = []
        for q in queries:
            results = await self.search(q)
            all_results.extend(results)
        return all_results
