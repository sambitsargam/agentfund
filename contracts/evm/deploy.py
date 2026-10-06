#!/usr/bin/env python3
"""Deploys AgentRatingRegistry to Base Sepolia with the key from the repo .env.

The key reaches forge only through the child environment, never argv or output.
Usage: python3 deploy.py [forwarder]   (defaults to the Base Sepolia simulation forwarder)
"""
import os
import pathlib
import subprocess
import sys

SIMULATION_FORWARDER = "0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5"
here = pathlib.Path(__file__).resolve().parent
values = {}
for line in (here.parent.parent / ".env").read_text().splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        key, value = line.split("=", 1)
        values[key] = value.strip()

key = values["CRE_ETH_PRIVATE_KEY"]
env = dict(
    os.environ,
    DEPLOYER_PRIVATE_KEY=key if key.startswith("0x") else "0x" + key,
    FORWARDER_ADDRESS=sys.argv[1] if len(sys.argv) > 1 else SIMULATION_FORWARDER,
)
subprocess.run(
    [str(pathlib.Path.home() / ".foundry/bin/forge"), "script", "script/DeployRegistry.s.sol:DeployRegistry",
     "--rpc-url", "https://sepolia.base.org", "--broadcast"],
    env=env, check=True, cwd=here,
)
