"""Audit-trail writer.

Writes signed receipts to the persistent disk volume mounted at
`USER_PERSISTENT_DATA_PATH` (`/mnt/disks/userdata` in TEE). The directory
survives image upgrades, so the trail is preserved as long as the app ID is.
Each receipt carries the TEE-wallet signature, so even if the file itself
were modified, the signature would no longer recover the deployed agent
address — the verify page surfaces this directly.

EigenDA writes for off-chain tamper-resistance are roadmap: there is no
first-party Python SDK, and the official `@layr-labs/agentkit-eigenda` JS
adapter is stale (last published 2025-02). We could route writes through the
Node sidecar with the community `eigenda-sdk-dev` package as a follow-up.
For now `eigenda_link: null` is the honest answer.
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
    digest = receipt.get("digest", "no-digest")
    fname = f"audit-{int(time.time())}-{digest[:8]}.json"
    path = s.audit_dir / fname
    path.write_text(json.dumps(receipt, indent=2, default=str))
    logger.info("audit wrote %s", path)
    return {
        "local_path": str(path),
        "eigenda_link": None,
        "storage": "tee-persistent-disk",
    }
