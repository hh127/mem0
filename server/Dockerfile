FROM python:3.12-slim

WORKDIR /app

# NOTE: the build context is the REPO ROOT (see .github/workflows/docker-build.yml), not server/.
# It has to be, because this image must ship THIS FORK's mem0 package rather than the PyPI release.
COPY server/requirements.txt .

# Force rebuild when requirements change (cache bust)
ARG CACHEBUST=1
RUN pip install --no-cache-dir -r requirements.txt

# requirements.txt only resolves *dependencies* — its `mem0ai` pin pulls the PyPI package, which
# does not contain this fork's additions (e.g. the `cloud_reranker` provider). Build the in-repo
# package and install it on top so the image matches what we run locally.
# Built in /tmp on purpose: a stray /app/mem0 directory would shadow the installed package,
# because uvicorn runs with /app as sys.path[0].
COPY pyproject.toml README.md LICENSE /tmp/mem0-src/
COPY mem0/ /tmp/mem0-src/mem0/
RUN pip install --no-cache-dir --no-deps /tmp/mem0-src && rm -rf /tmp/mem0-src

COPY server/ .

EXPOSE 8000

ENV PYTHONUNBUFFERED=1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
