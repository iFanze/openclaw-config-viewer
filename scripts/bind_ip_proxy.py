#!/usr/bin/env python3
import asyncio
import signal

BIND_HOST = "172.22.1.3"
BIND_PORT = 8787
TARGET_HOST = "127.0.0.1"
TARGET_PORT = 18787


async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def handle(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter):
    try:
        target_reader, target_writer = await asyncio.open_connection(TARGET_HOST, TARGET_PORT)
    except Exception:
        client_writer.close()
        await client_writer.wait_closed()
        return

    await asyncio.gather(
        pipe(client_reader, target_writer),
        pipe(target_reader, client_writer),
    )


async def main():
    server = await asyncio.start_server(handle, BIND_HOST, BIND_PORT)
    addrs = ", ".join(str(sock.getsockname()) for sock in (server.sockets or []))
    print(f"proxy listening on {addrs}, forwarding to {TARGET_HOST}:{TARGET_PORT}", flush=True)

    stop = asyncio.Event()

    def _stop(*_):
        stop.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, _stop)

    async with server:
        await stop.wait()


if __name__ == "__main__":
    asyncio.run(main())
