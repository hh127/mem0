FROM python:3.12

WORKDIR /app

# Install Poetry
RUN curl -sSL https://install.python-poetry.org | python3 -
ENV PATH="/root/.local/bin:$PATH"

# Copy requirements first for better caching
COPY server/requirements.txt .
RUN pip install -r requirements.txt

# Install the in-repo mem0 package. This fork's SDK changes (categories, decay,
# cloud_reranker, opencode) live here, not on PyPI, so installing `mem0ai` from
# PyPI would silently ship upstream behaviour.
# Installed under /opt on purpose: docker-compose mounts server/ over /app later,
# which would hide /app/packages and break the editable install.
WORKDIR /opt/mem0-src
COPY pyproject.toml .
COPY poetry.lock .
COPY README.md .
COPY mem0 ./mem0
RUN pip install -e .[graph]

# Return to app directory and copy server code
WORKDIR /app
COPY server .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
