"""Audit-trail writer.

In production this writes execution receipts to EigenDA via the data-availability
SDK so the trail is tamper-resistant beyond the agent itself. For the alpha
demo, EigenDA writes are stubbed — receipts go to the local audit directory
on the persistent disk volume (`USER_PERSISTENT_DATA_PATH`). The audit dir
survives image upgrades, so the trail is preserved as long as the app ID is.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from ..config import get_settings

logger = logging.getLogger(__name__)


async def write_to_eigenda(receipt: dict[str, Any]) -> dict[str, Any]:
    s = get_settings()
    fname = f"audit-{int(time.time())}-{receipt.get('digest', 'no-digest')[:8]}.json"
    path = s.audit_dir / fname
    path.write_text(json.dumps(receipt, indent=2, default=str))
    logger.info("audit wrote %s", path)
    return {"local_path": str(path), "eigendalink": None, "stubbed": True}
