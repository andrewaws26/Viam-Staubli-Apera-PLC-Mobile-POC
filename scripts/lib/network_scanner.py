"""
Network scanning utilities for IronSight PLC Auto-Discovery.

Extracted from plc-autodiscover.py. Contains:
  - eth0 carrier and IP address detection
  - Temporary IP management for cross-subnet scanning
  - Windows PC detection via SMB port scanning
  - SMB file grabbing (anonymous/guest)
  - Click PLC .ckp project file analysis
"""

import logging
import os
import socket
import subprocess
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger("ironsight-discover")

IFACE = "eth0"
SCAN_TIMEOUT = 0.3

# Project directory (resolved from this file's location)
PROJECT_DIR = Path(__file__).resolve().parent.parent.parent
GRABBED_DIR = PROJECT_DIR / "uploads" / "grabbed"

# File extensions we care about from Windows PCs
INTERESTING_FILES = {".ckp", ".csv", ".pdf", ".txt", ".xlsx", ".docx", ".dwg"}


# ─────────────────────────────────────────────────────────────
#  eth0 utilities
# ─────────────────────────────────────────────────────────────

def check_eth0_carrier() -> bool:
    """Check if eth0 has physical link (carrier detected).

    Returns:
        True if carrier is present.
    """
    try:
        carrier = Path(f"/sys/class/net/{IFACE}/carrier").read_text().strip()
        return carrier == "1"
    except Exception:
        return False


def get_eth0_ips() -> list[str]:
    """Get all IPv4 addresses currently assigned to eth0.

    Returns:
        List of IP address strings.
    """
    try:
        out = subprocess.check_output(
            ["ip", "-4", "addr", "show", IFACE],
            text=True, timeout=5
        )
        ips: list[str] = []
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("inet "):
                addr = line.split()[1].split("/")[0]
                ips.append(addr)
        return ips
    except Exception:
        return []


def add_temp_ip(subnet: str, host_id: int = 250) -> Optional[str]:
    """Temporarily add an IP on the given subnet to eth0.

    Args:
        subnet: Subnet prefix (e.g. '192.168.1').
        host_id: Host portion of the IP to add.

    Returns:
        The IP added (or existing IP on that subnet), or None on failure.
    """
    ip = f"{subnet}.{host_id}"

    existing = get_eth0_ips()
    for eip in existing:
        if eip.startswith(subnet + "."):
            return eip

    try:
        subprocess.run(
            ["ip", "addr", "add", f"{ip}/24", "dev", IFACE],
            check=True, capture_output=True, timeout=5
        )
        log.info("  Added temporary IP %s/24 to %s", ip, IFACE)
        return ip
    except subprocess.CalledProcessError:
        return None
    except Exception as e:
        log.warning("  Failed to add IP %s: %s", ip, e)
        return None


def remove_temp_ip(ip: str) -> None:
    """Remove a temporarily added IP from eth0.

    Args:
        ip: IP address to remove.
    """
    try:
        subprocess.run(
            ["ip", "addr", "del", f"{ip}/24", "dev", IFACE],
            capture_output=True, timeout=5
        )
        log.debug("  Removed temporary IP %s from %s", ip, IFACE)
    except Exception:
        pass


def cleanup_temp_ips(keep_subnet: Optional[str] = None) -> None:
    """Remove all temporary IPs from eth0 except the one to keep.

    Args:
        keep_subnet: Subnet prefix to preserve (e.g. '192.168.1').
    """
    existing = get_eth0_ips()
    for ip in existing:
        subnet = ".".join(ip.split(".")[:3])
        if keep_subnet and subnet == keep_subnet:
            continue
        if ip.endswith(".250"):
            remove_temp_ip(ip)


def set_eth0_permanent_ip(pi_ip: str) -> None:
    """Add the permanent static IP to eth0 (remove temps, add final).

    Args:
        pi_ip: The permanent IP address to set.
    """
    existing = get_eth0_ips()
    for eip in existing:
        if eip != pi_ip:
            remove_temp_ip(eip)

    if pi_ip not in get_eth0_ips():
        try:
            subprocess.run(
                ["ip", "addr", "add", f"{pi_ip}/24", "dev", IFACE],
                check=True, capture_output=True, timeout=5
            )
            log.info("  Set permanent eth0 IP: %s/24", pi_ip)
        except Exception as e:
            log.warning("  Could not set eth0 IP %s: %s", pi_ip, e)


# ─────────────────────────────────────────────────────────────
#  Windows PC detection
# ─────────────────────────────────────────────────────────────

def probe_smb_port(host: str, timeout: float = SCAN_TIMEOUT) -> bool:
    """Check if SMB (port 445) is open -- indicates a Windows PC.

    Args:
        host: Target IP address.
        timeout: Connection timeout in seconds.

    Returns:
        True if SMB port is reachable.
    """
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((host, 445))
        sock.close()
        return result == 0
    except Exception:
        return False


def find_windows_pcs(write_status_fn: callable) -> list[str]:
    """Scan all subnets on eth0 for devices with SMB (port 445) open.

    Args:
        write_status_fn: Callable for status updates.

    Returns:
        List of Windows PC IP addresses.
    """
    pcs: list[str] = []
    log.info("Scanning for Windows PCs (SMB port 445)...")
    write_status_fn("scanning", "Looking for Windows PCs...", 50)

    try:
        out = subprocess.check_output(["ip", "neigh", "show", "dev", IFACE],
                                       text=True, timeout=5)
        for line in out.strip().splitlines():
            parts = line.split()
            if parts and parts[0] not in get_eth0_ips():
                ip = parts[0]
                if probe_smb_port(ip, timeout=1):
                    log.info("  > Windows PC found at %s", ip)
                    pcs.append(ip)
    except Exception:
        pass

    if not pcs:
        for our_ip in get_eth0_ips():
            subnet = ".".join(our_ip.split(".")[:3])
            for host_id in [1, 2, 10, 50, 100, 101, 102, 150, 200]:
                ip = f"{subnet}.{host_id}"
                if ip in get_eth0_ips():
                    continue
                if probe_smb_port(ip, timeout=0.5):
                    log.info("  > Windows PC found at %s", ip)
                    pcs.append(ip)

    return pcs


# ─────────────────────────────────────────────────────────────
#  SMB file grabbing
# ─────────────────────────────────────────────────────────────

def grab_files_from_pc(host: str, write_status_fn: callable) -> list[str]:
    """Connect to a Windows PC via SMB and grab any interesting files.

    Args:
        host: Windows PC IP address.
        write_status_fn: Callable for status updates.

    Returns:
        List of local paths to downloaded files.
    """
    GRABBED_DIR.mkdir(parents=True, exist_ok=True)
    grabbed: list[str] = []

    log.info("Connecting to Windows PC at %s via SMB...", host)
    write_status_fn("grabbing", f"Scanning Windows PC at {host} for files...", 60)

    shares = _list_smb_shares(host)

    for share in shares:
        log.info("  Searching share: //%s/%s", host, share)
        write_status_fn("grabbing", f"Searching //{host}/{share}...", 70)

        try:
            out = subprocess.check_output(
                ["smbclient", f"//{host}/{share}", "-N",
                 "--option=client min protocol=SMB2",
                 "-c", "recurse; ls"],
                text=True, timeout=30, stderr=subprocess.STDOUT
            )

            for line in out.splitlines():
                line = line.strip()
                for ext in INTERESTING_FILES:
                    if ext in line.lower():
                        parts = line.split()
                        if parts:
                            fname = parts[0]
                            if fname.lower().endswith(ext):
                                grabbed_files = _grab_file(host, share, fname, write_status_fn)
                                grabbed.extend(grabbed_files)

        except Exception as e:
            log.debug("  Error searching %s: %s", share, e)

    # Targeted search for .ckp files specifically
    if not any(f.endswith(".ckp") for f in grabbed):
        for share in shares:
            try:
                for search_dir in ["", "\\\\Click", "\\\\PLC", "\\\\Programs",
                                   "\\\\Documents", "\\\\Desktop"]:
                    cmd = f'cd {search_dir}; ls *.ckp' if search_dir else 'ls *.ckp'
                    out = subprocess.check_output(
                        ["smbclient", f"//{host}/{share}", "-N",
                         "--option=client min protocol=SMB2",
                         "-c", cmd],
                        text=True, timeout=15, stderr=subprocess.STDOUT
                    )
                    for line in out.splitlines():
                        line = line.strip()
                        if ".ckp" in line.lower():
                            parts = line.split()
                            if parts:
                                fname = parts[0]
                                if fname.lower().endswith(".ckp"):
                                    path = f"{search_dir}\\\\{fname}" if search_dir else fname
                                    grabbed_files = _grab_file(host, share, path, write_status_fn)
                                    grabbed.extend(grabbed_files)
            except Exception:
                pass

    if grabbed:
        log.info("> Grabbed %d files from %s: %s", len(grabbed), host,
                 [os.path.basename(f) for f in grabbed])
        write_status_fn("grabbed", f"Got {len(grabbed)} files from Windows PC", 90)
    else:
        log.info("  No interesting files found on %s", host)
        write_status_fn("no_files", f"No .ckp or project files found on {host}", 90)

    return grabbed


def _list_smb_shares(host: str) -> list[str]:
    """List SMB shares on a Windows PC (anonymous then guest).

    Args:
        host: Windows PC IP address.

    Returns:
        List of share name strings.
    """
    shares: list[str] = []

    def _parse_shares(output: str) -> list[str]:
        result = []
        for line in output.splitlines():
            line = line.strip()
            if "Disk" in line and not line.startswith("---"):
                share_name = line.split()[0]
                if share_name.upper() not in ("IPC$", "PRINT$", "ADMIN$", "C$", "D$"):
                    result.append(share_name)
        return result

    try:
        out = subprocess.check_output(
            ["smbclient", "-L", f"//{host}", "-N", "--option=client min protocol=SMB2"],
            text=True, timeout=15, stderr=subprocess.STDOUT
        )
        shares = _parse_shares(out)
        log.info("  Found shares: %s", shares)
    except subprocess.CalledProcessError:
        log.info("  Anonymous share listing failed, trying guest...")
        try:
            out = subprocess.check_output(
                ["smbclient", "-L", f"//{host}", "-U", "guest%",
                 "--option=client min protocol=SMB2"],
                text=True, timeout=15, stderr=subprocess.STDOUT
            )
            shares = _parse_shares(out)
            log.info("  Found shares (guest): %s", shares)
        except Exception:
            log.warning("  Could not list shares on %s", host)
    except Exception as e:
        log.warning("  SMB error: %s", e)

    return shares


def _grab_file(host: str, share: str, remote_path: str,
               write_status_fn: callable) -> list[str]:
    """Download a single file from an SMB share.

    Args:
        host: Windows PC IP address.
        share: SMB share name.
        remote_path: Remote file path within the share.
        write_status_fn: Callable for status updates.

    Returns:
        List containing the local path if successful, else empty.
    """
    grabbed: list[str] = []
    fname = os.path.basename(remote_path.replace("\\\\", "/").replace("\\", "/"))
    local_path = GRABBED_DIR / fname

    if local_path.exists():
        log.info("    Already have %s -- skipping", fname)
        return [str(local_path)]

    log.info("    Grabbing: %s", fname)
    write_status_fn("grabbing", f"Downloading {fname}...", 75)

    try:
        subprocess.check_output(
            ["smbclient", f"//{host}/{share}", "-N",
             "--option=client min protocol=SMB2",
             "-c", f'get "{remote_path}" "{local_path}"'],
            text=True, timeout=60, stderr=subprocess.STDOUT
        )
        if local_path.exists() and local_path.stat().st_size > 0:
            log.info("    > Saved: %s (%d bytes)", local_path, local_path.stat().st_size)
            grabbed.append(str(local_path))

            if fname.lower().endswith(".ckp"):
                analyze_ckp(str(local_path))
        else:
            log.warning("    > Download produced empty file: %s", fname)
    except Exception as e:
        log.warning("    > Failed to grab %s: %s", fname, e)

    return grabbed


# ─────────────────────────────────────────────────────────────
#  Click PLC .ckp project analysis
# ─────────────────────────────────────────────────────────────

def analyze_ckp(filepath: str) -> None:
    """Try to extract useful information from a Click PLC .ckp project file.

    Args:
        filepath: Path to the .ckp file.
    """
    log.info("=" * 60)
    log.info("Analyzing Click PLC project file: %s", os.path.basename(filepath))
    log.info("=" * 60)

    analysis_path = GRABBED_DIR / (os.path.splitext(os.path.basename(filepath))[0] + "-analysis.md")
    results: list[str] = []
    results.append(f"# Click PLC Project Analysis: {os.path.basename(filepath)}")
    results.append(f"Analyzed: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    results.append(f"Size: {os.path.getsize(filepath)} bytes")
    results.append("")

    # 1. Check file type
    try:
        out = subprocess.check_output(["file", filepath], text=True, timeout=5)
        results.append(f"## File type\n{out.strip()}\n")
        log.info("  File type: %s", out.strip())
    except Exception:
        pass

    # 2. Try to unzip
    try:
        out = subprocess.check_output(
            ["unzip", "-l", filepath], text=True, timeout=10, stderr=subprocess.STDOUT
        )
        results.append(f"## ZIP contents\n```\n{out}\n```\n")
        log.info("  It's a ZIP file! Extracting...")

        extract_dir = GRABBED_DIR / (os.path.splitext(os.path.basename(filepath))[0])
        extract_dir.mkdir(exist_ok=True)
        subprocess.run(["unzip", "-o", filepath, "-d", str(extract_dir)],
                       capture_output=True, timeout=30)
        results.append(f"Extracted to: {extract_dir}\n")

        for root, dirs, files in os.walk(extract_dir):
            for f in files:
                fpath = os.path.join(root, f)
                try:
                    content = open(fpath, "r", errors="replace").read(5000)
                    results.append(f"### {f}\n```\n{content[:3000]}\n```\n")
                except Exception:
                    pass

    except subprocess.CalledProcessError:
        results.append("## Not a ZIP file\n")

    # 3. Extract strings
    try:
        out = subprocess.check_output(
            ["strings", "-n", "4", filepath], text=True, timeout=15
        )
        lines = out.splitlines()
        results.append(f"## Readable strings ({len(lines)} found)\n")

        interesting: list[str] = []
        for line in lines:
            line_lower = line.lower().strip()
            if any(kw in line_lower for kw in [
                "ds", "dd", "timer", "counter", "encoder", "plate", "eject",
                "speed", "distance", "travel", "spacing", "count", "pulse",
                "tps", "air", "eagle", "camera", "power", "loop",
                "highspeed", "hsc", "reset", "preset",
                "x001", "x002", "x003", "x004", "y001", "y002",
            ]):
                interesting.append(line.strip())

        if interesting:
            results.append("### Register/PLC-related strings\n```")
            for s in interesting[:100]:
                results.append(s)
            results.append("```\n")

        nicknames = [l.strip() for l in lines if len(l.strip()) > 3 and len(l.strip()) < 50
                     and not l.strip().startswith("\\") and not l.strip().startswith("/")]
        results.append(f"### All unique labels ({len(set(nicknames))} unique)\n```")
        for s in sorted(set(nicknames))[:200]:
            results.append(s)
        results.append("```\n")

    except Exception as e:
        results.append(f"## String extraction failed: {e}\n")

    # 4. Hex header analysis
    try:
        with open(filepath, "rb") as f:
            header = f.read(256)
        hex_lines: list[str] = []
        for i in range(0, min(256, len(header)), 16):
            chunk = header[i:i+16]
            hex_part = " ".join(f"{b:02x}" for b in chunk)
            ascii_part = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
            hex_lines.append(f"{i:04x}: {hex_part:<48s} {ascii_part}")
        results.append(f"## File header (hex)\n```\n" + "\n".join(hex_lines) + "\n```\n")
    except Exception:
        pass

    analysis_text = "\n".join(results)
    analysis_path.write_text(analysis_text)
    log.info("  Analysis saved to: %s", analysis_path)

    Path("/tmp/ironsight-latest-upload").write_text(str(filepath))
