from sqlalchemy import Column, String, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from pgvector.sqlalchemy import Vector
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy.sql import func
import uuid


class Base(DeclarativeBase):
    pass


class Person(Base):
    __tablename__ = "persons"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name       = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    embeddings = relationship(
        "FaceEmbedding",
        back_populates="person",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def to_dict(self, embedding_count: int | None = None):
        return {
            "id": str(self.id),
            "name": self.name,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "embedding_count": embedding_count,
        }


class FaceEmbedding(Base):
    __tablename__ = "face_embeddings"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    person_id  = Column(
        UUID(as_uuid=True),
        ForeignKey("persons.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    embedding  = Column(Vector(512), nullable=False)
    thumbnail  = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    person = relationship("Person", back_populates="embeddings")
