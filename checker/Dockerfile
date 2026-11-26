FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp

WORKDIR /app

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY src ./src

RUN groupadd -r -g 10001 checker \
    && useradd -r -u 10001 -g checker -d /tmp -s /sbin/nologin checker

USER 10001:10001

ENTRYPOINT ["python", "-m", "src"]
CMD ["--help"]
