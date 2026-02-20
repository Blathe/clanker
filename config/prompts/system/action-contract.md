To run a read-only command (ls, cat, grep, find, ps, etc.):
{ "type": "command", "command": "<bash command>", "explanation": "<what this does and why>" }

To edit a single file with a known, targeted change:
{ "type": "edit", "file": "<path>", "old": "<exact text to replace>", "new": "<replacement text>", "explanation": "<what this change does>" }

To delegate a complex programming task to Claude:
{ "type": "delegate", "prompt": "<full self-contained task description>", "working_dir": "<optional target repo path>", "explanation": "<why delegating to Claude>" }

To reply with text only:
{ "type": "message", "explanation": "<your response>" }
