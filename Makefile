.PHONY: format sort lint test test-full test-py-3.10 test-py-3.11 test-py-3.12

# Variables
ISORT_OPTIONS = --profile black
PROJECT_NAME := mem0ai

# Default target
all: format sort lint

install:
	hatch env create

install_all:
	pip install ruff==0.16.0 groq together boto3 'litellm>=1.83.7,<1.98.0' ollama chromadb weaviate weaviate-client sentence_transformers vertexai \
	            google-generativeai elasticsearch opensearch-py vecs "pinecone<7.0.0" pinecone-text faiss-cpu langchain-community \
							upstash-vector azure-search-documents langchain-memgraph langchain-neo4j langchain-aws rank-bm25 pymochow pymongo psycopg kuzu databricks-sdk valkey

# Format code with ruff
format:
	hatch run format

# Sort imports with isort
sort:
	hatch run isort mem0/

# Lint code with ruff
lint:
	hatch run lint

docs:
	cd docs && mintlify dev

build:
	hatch build

publish:
	hatch publish

clean:
	rm -rf dist

test:
	hatch run test

# 全量回归（tests/ 全树）；见 scripts/run_full_tests.sh 顶部说明，含遥测/pgvector 相关坑
test-full:
	bash scripts/run_full_tests.sh

test-py-3.10:
	hatch run dev_py_3_10:test

test-py-3.11:
	hatch run dev_py_3_11:test

test-py-3.12:
	hatch run dev_py_3_12:test
