"""Pydantic request/response schemas."""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import Direction, GoalStatus, IndicatorType, MeasurementType, TargetPeriod


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Activities ----------
class ActivityBase(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    category: str = Field(min_length=1, max_length=40)
    measurement_type: MeasurementType = MeasurementType.count
    unit: str = Field(default="count", max_length=20)
    target_value: float = Field(gt=0)
    target_period: TargetPeriod = TargetPeriod.daily
    direction: Direction = Direction.higher_is_better
    indicator_type: IndicatorType = IndicatorType.leading
    importance: int = Field(default=3, ge=1, le=5)
    color: str = Field(default="#7c8cff", pattern=r"^#[0-9a-fA-F]{6}$")

    @model_validator(mode="after")
    def _duration_units(self):
        if self.measurement_type == MeasurementType.duration and self.unit not in ("minutes", "hours"):
            raise ValueError("duration activities must use unit 'minutes' or 'hours'")
        if self.measurement_type == MeasurementType.boolean:
            self.unit = "done"
        return self


class ActivityCreate(ActivityBase):
    pass


class ActivityUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    category: str | None = None
    unit: str | None = None
    target_value: float | None = Field(default=None, gt=0)
    target_period: TargetPeriod | None = None
    direction: Direction | None = None
    indicator_type: IndicatorType | None = None
    importance: int | None = Field(default=None, ge=1, le=5)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    archived: bool | None = None


class ActivityOut(ActivityBase, ORM):
    id: int
    archived: bool
    created_on: date


# ---------- Entries ----------
class EntryCreate(BaseModel):
    activity_id: int
    date: date
    value: float = Field(ge=0)
    note: str | None = Field(default=None, max_length=280)
    mode: str = Field(default="set", pattern="^(set|add)$")  # set = replace the day's total, add = append


class EntryOut(ORM):
    id: int
    activity_id: int
    date: date
    value: float
    note: str | None


class DayActivity(BaseModel):
    activity: ActivityOut
    value: float
    target: float  # daily target for daily activities, weekly target for weekly ones
    week_to_date: float
    progress: float  # 0..1+ for the relevant period
    met: bool
    history: list[float | None] = []  # last 14 days, for sparklines


class DayLog(BaseModel):
    date: date
    activities: list[DayActivity]
    tracked: int
    completed: int


# ---------- Goals ----------
class MilestoneIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    target_date: date | None = None


class MilestoneOut(ORM):
    id: int
    title: str
    target_date: date | None
    done: bool
    done_on: date | None


class GoalCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    category: str = Field(min_length=1, max_length=40)
    desired_outcome: str = ""
    start_date: date | None = None
    target_date: date
    weekly_hours_commitment: float = Field(default=0, ge=0)
    activity_ids: list[int] = []
    metric_activity_id: int | None = None
    metric_target: float | None = Field(default=None, gt=0)
    milestones: list[MilestoneIn] = []

    @field_validator("milestones")
    @classmethod
    def _cap(cls, v):
        if len(v) > 30:
            raise ValueError("max 30 milestones")
        return v


class GoalUpdate(BaseModel):
    title: str | None = None
    desired_outcome: str | None = None
    target_date: date | None = None
    weekly_hours_commitment: float | None = Field(default=None, ge=0)
    status: GoalStatus | None = None
    activity_ids: list[int] | None = None
    metric_activity_id: int | None = None
    metric_target: float | None = Field(default=None, gt=0)


class GoalOut(ORM):
    id: int
    title: str
    category: str
    desired_outcome: str
    start_date: date
    target_date: date
    weekly_hours_commitment: float
    status: GoalStatus
    metric_activity_id: int | None
    metric_target: float | None
    activity_ids: list[int]
    milestones: list[MilestoneOut]
    progress: dict  # computed by the analytics engine


# ---------- Reflections ----------
class ReflectionIn(BaseModel):
    week_start: date
    went_well: str = Field(default="", max_length=4000)
    didnt_go_well: str = Field(default="", max_length=4000)
    adjust_next: str = Field(default="", max_length=4000)


class ReflectionOut(ReflectionIn, ORM):
    id: int
