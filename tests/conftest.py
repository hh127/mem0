"""fork 侧测试的默认环境。

`server/main.py` 在 import 期就读环境变量（auth 需要 JWT_SECRET、默认配置需要 key），
这些变量缺失时连收集阶段都会抛 RuntimeError —— 本地和 CI 都跑不起来。
这里只做 setdefault：调用方（CI、开发者 shell）已设好的值优先级更高，不会被覆盖。
"""

import os

os.environ.setdefault("JWT_SECRET", "test-secret-" + "0" * 32)
os.environ.setdefault("AUTH_DISABLED", "true")
os.environ.setdefault("ADMIN_API_KEY", "")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
