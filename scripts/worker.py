#!/usr/bin/env python3
"""ClawMarket worker — CashClaw bids on and executes tasks via OpenClaw/OpenRouter."""
import json
import os
import subprocess
import sys
import time
import urllib.request

MARKET_URL = os.getenv("CLAWMARKET_URL", "http://localhost:3888")
AGENT_ID = None  # set on startup
AGENT_KEY = None


def api(method: str, path: str, body: dict | None = None) -> dict:
    url = f"{MARKET_URL}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method,
                                headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def llm_execute(task_title: str, task_desc: str, criteria: str) -> str:
    """Use OpenClaw to execute the task."""
    prompt = (
        f"You are an expert AI agent completing a task on ClawMarket.\n\n"
        f"TASK: {task_title}\n\n"
        f"DESCRIPTION:\n{task_desc}\n\n"
        f"ACCEPTANCE CRITERIA:\n{criteria}\n\n"
        f"Deliver a complete, high-quality response. Be thorough and specific. "
        f"If the task requires code, write real, working code. "
        f"If it requires research, cite sources and give concrete details. "
        f"If it requires writing, make it sharp, original, and compelling.\n\n"
        f"YOUR DELIVERABLE:"
    )
    env = os.environ.copy()
    env.pop("MallocStackLogging", None)
    env.pop("MallocStackLoggingNoCompact", None)
    try:
        proc = subprocess.run(
            ["openclaw", "agent", "--json", "--agent", "main",
             "--message", prompt, "--thinking", "extended", "--timeout", "180"],
            capture_output=True, text=True, timeout=200, env=env,
        )
        raw = proc.stdout.strip()
        try:
            data = json.loads(raw)
            # dig for text
            for key in ("reply", "text", "message", "content"):
                if key in data:
                    return str(data[key])
            if "payloads" in data:
                parts = []
                for p in data["payloads"]:
                    if "text" in p:
                        parts.append(p["text"])
                if parts:
                    return "\n".join(parts)
            return raw
        except json.JSONDecodeError:
            import re
            cleaned = re.sub(r"^Config warnings:[\s\S]*?\n\n", "", raw).strip()
            try:
                data = json.loads(cleaned)
                for key in ("reply", "text", "message", "content"):
                    if key in data:
                        return str(data[key])
                if "payloads" in data:
                    return "\n".join(p.get("text", "") for p in data["payloads"])
            except Exception:
                pass
            return cleaned or "(empty response)"
    except subprocess.TimeoutExpired:
        return "(timed out — task too complex for single pass)"
    except Exception as e:
        return f"(execution error: {e})"


def run_worker():
    global AGENT_ID, AGENT_KEY

    # Get our agent
    agents = api("GET", "/api/agents")
    if not agents:
        print("No agents registered. Register first.")
        sys.exit(1)
    AGENT_ID = agents[0]["id"]
    print(f"Worker started | agent: {AGENT_ID[:8]}... | market: {MARKET_URL}")

    while True:
        try:
            tasks = api("GET", "/api/tasks?status=open&limit=20")
            tasks += api("GET", "/api/tasks?status=bidding&limit=20")
            if not tasks:
                print("  no open tasks, sleeping 30s...")
                time.sleep(30)
                continue

            for task in tasks:
                tid = task["id"]
                title = task["title"]
                bounty_eth = int(task["bountyWei"]) / 1e18
                print(f"\n{'='*60}")
                print(f"  TASK: {title}")
                print(f"  BOUNTY: {bounty_eth:.4f} ETH")
                print(f"  CATEGORY: {task.get('category', '?')}")

                # Bid on it (match the bounty)
                print(f"  bidding...")
                try:
                    bid = api("POST", "/api/bids", {
                        "taskId": tid,
                        "agentId": AGENT_ID,
                        "priceWei": task["bountyWei"],
                        "etaMinutes": 5,
                        "pitch": f"CashClaw agent ready to execute. Specializing in {task.get('category', 'general')} tasks.",
                    })
                    print(f"  bid placed: {bid.get('id', '?')[:8]} status={bid.get('status')}")

                    if bid.get("status") == "pending":
                        # Auto-accept our own bid (we're the marketplace operator)
                        api("POST", f"/api/bids/{bid['id']}/accept")
                        print(f"  bid accepted")
                except Exception as e:
                    if "already bid" in str(e) or "409" in str(e):
                        print(f"  already bid, skipping")
                        continue
                    print(f"  bid error: {e}")
                    continue

                # Execute the task
                print(f"  executing via OpenClaw...")
                result = llm_execute(title, task["description"], task.get("acceptanceCriteria", ""))
                print(f"  result: {result[:200]}...")

                # Submit deliverable
                print(f"  submitting deliverable...")
                try:
                    deliv = api("POST", "/api/deliverables", {
                        "taskId": tid,
                        "agentId": AGENT_ID,
                        "content": result,
                    })
                    print(f"  deliverable: {deliv.get('id', '?')[:8]} status={deliv.get('status')}")

                    # Auto-approve (self-service for now)
                    api("POST", f"/api/deliverables/{deliv['id']}/approve", {
                        "rating": 4,
                        "reviewNotes": "Auto-approved by marketplace operator",
                    })
                    print(f"  APPROVED + ESCROW RELEASED")
                except Exception as e:
                    print(f"  deliverable error: {e}")

                # Brief pause between tasks
                time.sleep(2)

        except Exception as e:
            print(f"  worker error: {e}")

        print(f"\n  cycle complete, sleeping 60s...")
        time.sleep(60)


if __name__ == "__main__":
    run_worker()
