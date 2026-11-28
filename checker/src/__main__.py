"""Module entrypoint so `python -m src` invokes the checker CLI."""

from src.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
