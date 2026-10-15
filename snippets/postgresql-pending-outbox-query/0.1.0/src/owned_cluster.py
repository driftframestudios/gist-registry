"""One invocation-owned PostgreSQL 17 cluster; connection locators stay local."""

import shutil
import signal
import subprocess
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path


class ClusterError(RuntimeError):
    """A local runtime operation requires correction before another run."""


def command(arguments, log, operation):
    """Keep process diagnostics in the private cluster directory."""
    try:
        with log.open("ab") as output:
            result = subprocess.run(
                [str(argument) for argument in arguments],
                stdout=output,
                stderr=subprocess.STDOUT,
                timeout=60,
                check=False,
            )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ClusterError(f"{operation} failed; inspect the local runtime and retry") from error
    if result.returncode:
        raise ClusterError(f"{operation} failed; inspect the local runtime and retry")


def postgres_binaries(directory):
    directory = Path(directory).resolve(strict=True)
    binaries = {name: directory / name for name in ("postgres", "initdb", "pg_ctl", "pg_isready")}
    for binary in binaries.values():
        if not binary.is_file():
            raise ClusterError("Supply the bin directory of a complete PostgreSQL 17 installation")
    try:
        version = subprocess.run(
            [str(binaries["postgres"]), "--version"],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError) as error:
        raise ClusterError(
            "The selected PostgreSQL executable could not report its version"
        ) from error
    if not version.startswith("postgres (PostgreSQL) 17."):
        raise ClusterError("This coordinate requires PostgreSQL major version 17")
    return binaries


def await_ready(server, binary, socket_directory):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise ClusterError("The owned PostgreSQL server exited during startup")
        result = subprocess.run(
            [
                str(binary),
                "-h",
                str(socket_directory),
                "-U",
                "fixture_owner",
                "-d",
                "postgres",
                "-t",
                "1",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=2,
            check=False,
        )
        if result.returncode == 0:
            return
        if result.returncode not in (1, 2):
            raise ClusterError("The readiness probe could not inspect the owned server")
        time.sleep(0.05)
    raise ClusterError("The owned PostgreSQL server exceeded its startup deadline")


def stop_owned_server(server):
    if server.poll() is None:
        server.send_signal(signal.SIGQUIT)
    server.wait(timeout=30)


@contextmanager
def owned_cluster(directory):
    """Release only the new cluster; retain its directory when shutdown needs repair."""
    binaries = postgres_binaries(directory)
    # A short, mode-0700 directory keeps Unix sockets within platform path limits.
    root = Path(tempfile.mkdtemp(prefix="pending-pg-", dir="/tmp"))
    data, log = root / "data", root / "runtime.log"
    primary = None
    server = None
    try:
        command(
            [
                binaries["initdb"],
                "-D",
                data,
                "--username=fixture_owner",
                "--auth-local=trust",
                "--auth-host=reject",
                "--encoding=UTF8",
                "--no-locale",
            ],
            log,
            "cluster initialization",
        )
        with (data / "postgresql.conf").open("a") as settings:
            settings.write(
                "\nlisten_addresses = ''\n"
                f"unix_socket_directories = '{root}'\n"
                "unix_socket_permissions = 0700\n"
                "max_connections = 10\nshared_buffers = '32MB'\n"
            )
        # Own the actual server process before readiness; a PID-file race cannot erase ownership.
        with log.open("ab") as output:
            server = subprocess.Popen(
                [str(binaries["postgres"]), "-D", str(data)],
                stdout=output,
                stderr=subprocess.STDOUT,
            )
        await_ready(server, binaries["pg_isready"], root)
        yield {"host": str(root), "dbname": "postgres", "connect_timeout": 5}
    except BaseException as error:
        primary = error
        raise
    finally:
        try:
            if server is not None:
                stop_owned_server(server)
            shutil.rmtree(root)
        except BaseException as cleanup:
            cleanup.add_note(f"Owned cluster directory retained for local recovery: {root}")
            if primary is not None:
                raise BaseExceptionGroup(
                    "Cluster body and cleanup require attention", [primary, cleanup]
                ) from None
            raise
