from enum import Enum


class AgentStep(str, Enum):
    REQUIREMENTS = "requirements"
    SEARCHING = "searching"
    REWRITING = "rewriting"
    VALIDATING = "validating"
    COMPLETED = "completed"
    FAILED = "failed"


STEP_ORDER = [
    AgentStep.REQUIREMENTS,
    AgentStep.SEARCHING,
    AgentStep.REWRITING,
    AgentStep.VALIDATING,
    AgentStep.COMPLETED,
]
