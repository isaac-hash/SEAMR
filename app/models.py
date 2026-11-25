"""SQLAlchemy ORM models for LIFEOS."""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class MeasurementType(str, enum.Enum):
    count = "count"  # pages, reps, words...
    duration = "duration"  # minutes / hours -> feeds "development hours"
    boolean = "boolean"  # done / not done (1 / 0)


class TargetPeriod(str, enum.Enum):
    daily = "daily"
    weekly = "weekly"


class Direction(str, enum.Enum):
    higher_is_better = "higher_is_better"
    lower_is_better = "lower_is_better"  # e.g. screen time, alcohol
    target_is_best = "target_is_best"  # e.g. sleep: hitting the target matters, more isn't better


class IndicatorType(str, enum.Enum):
    leading = "leading"  # effort: 30 min of French
    lagging = "lagging"  # result: words remembered


class GoalStatus(str, enum.Enum):
    active = "active"
    paused = "paused"
    completed = "completed"


goal_activities = Table(
    "goal_activities",
    Base.metadata,
    Column("goal_id", ForeignKey("goals.id", ondelete="CASCADE"), primary_key=True),
    Column("activity_id", ForeignKey("activities.id", ondelete="CASCADE"), primary_key=True),
)


class Activity(Base):
    __tablename__ = "activities"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    category: Mapped[str] = mapped_column(String(40), index=True)
    measurement_type: Mapped[MeasurementType] = mapped_column(Enum(MeasurementType, native_enum=False))
    unit: Mapped[str] = mapped_column(String(20), default="count")
    target_value: Mapped[float] = mapped_column(Float)
    target_period: Mapped[TargetPeriod] = mapped_column(Enum(TargetPeriod, native_enum=False))
    direction: Mapped[Direction] = mapped_column(
        Enum(Direction, native_enum=False), default=Direction.higher_is_better
    )
    indicator_type: Mapped[IndicatorType] = mapped_column(
        Enum(IndicatorType, native_enum=False), default=IndicatorType.leading
    )
    importance: Mapped[int] = mapped_column(Integer, default=3)  # 1-5 weighting
    color: Mapped[str] = mapped_column(String(9), default="#7c8cff")
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_on: Mapped[date] = mapped_column(Date, default=date.today)

    entries: Mapped[list[Entry]] = relationship(back_populates="activity", cascade="all, delete-orphan")
    goals: Mapped[list[Goal]] = relationship(secondary=goal_activities, back_populates="activities")


class Entry(Base):
    __tablename__ = "entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    value: Mapped[float] = mapped_column(Float)
    note: Mapped[str | None] = mapped_column(String(280), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    activity: Mapped[Activity] = relationship(back_populates="entries")


class Goal(Base):
    """A 'Development Project' – connects daily activities to a long-term outcome."""

    __tablename__ = "goals"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(40))
    desired_outcome: Mapped[str] = mapped_column(Text, default="")
    start_date: Mapped[date] = mapped_column(Date, default=date.today)
    target_date: Mapped[date] = mapped_column(Date)
    weekly_hours_commitment: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[GoalStatus] = mapped_column(Enum(GoalStatus, native_enum=False), default=GoalStatus.active)
    # Optional measurable outcome: cumulative total of one activity, e.g. 7,200 pages for 24 books
    metric_activity_id: Mapped[int | None] = mapped_column(
        ForeignKey("activities.id", ondelete="SET NULL"), nullable=True
    )
    metric_target: Mapped[float | None] = mapped_column(Float, nullable=True)

    activities: Mapped[list[Activity]] = relationship(secondary=goal_activities, back_populates="goals")
    milestones: Mapped[list[Milestone]] = relationship(
        back_populates="goal", cascade="all, delete-orphan", order_by="Milestone.target_date"
    )
    metric_activity: Mapped[Activity | None] = relationship(foreign_keys=[metric_activity_id])


class Milestone(Base):
    __tablename__ = "milestones"

    id: Mapped[int] = mapped_column(primary_key=True)
    goal_id: Mapped[int] = mapped_column(ForeignKey("goals.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    done_on: Mapped[date | None] = mapped_column(Date, nullable=True)

    goal: Mapped[Goal] = relationship(back_populates="milestones")


class Reflection(Base):
    """Weekly reflection: what worked, what didn't, what to adjust."""

    __tablename__ = "reflections"
    __table_args__ = (UniqueConstraint("week_start"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    week_start: Mapped[date] = mapped_column(Date)
    went_well: Mapped[str] = mapped_column(Text, default="")
    didnt_go_well: Mapped[str] = mapped_column(Text, default="")
    adjust_next: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class AppState(Base):
    """Small key/value store, e.g. remembers that demo data was seeded so 'Start fresh' sticks."""

    __tablename__ = "app_state"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[str] = mapped_column(String(200), default="")
