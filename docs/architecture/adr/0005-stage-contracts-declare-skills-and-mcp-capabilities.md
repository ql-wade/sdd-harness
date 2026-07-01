# Declare skills and MCP capabilities per workflow stage

SDD Harness requires each workflow stage to declare its command, owning wrapper skill, allowed underlying skills, MCP capabilities, input artifacts, output artifacts, and gate rules. This makes the packaged toolchain auditable and prevents agents from improvising hidden workflow paths that bypass domain registry checks, OpenSpec/Trinity lifecycle operations, test linkage, or evidence writeback.
