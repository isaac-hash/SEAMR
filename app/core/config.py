"""Application settings, loaded from environment variables / .env."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="LIFEOS_", extra="ignore")

    app_name: str = "LIFEOS"
    environment: str = "development"  # development | production | test
    debug: bool = False
    log_level: str = "INFO"

    database_url: str = "sqlite:///./data/lifeos.db"
    seed_demo_data: bool = True  # seed 12 weeks of demo data when the DB is empty

    # Analytics tuning
    streak_threshold: float = 0.7  # a day counts toward the streak at >= 70% performance index
    growth_alert_pct: float = 10.0  # +/- change that triggers improving / declining alerts
    week_start: int = 0  # 0 = Monday

    # CORS (only needed if you host a separate frontend)
    cors_origins: list[str] = []

    # Optional AI weekly summary (rule-based observations are used when this is empty)
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5-5"


@lru_cache
def get_settings() -> Settings:
    return Settings()
