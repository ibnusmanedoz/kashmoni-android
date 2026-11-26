#!/data/data/com.termux/files/usr/bin/bash
# Kash Moni AI - Termux setup (run once):  bash setup.sh
set -e
echo "== Installing Python, Node.js and Git (a few minutes) =="
pkg update -y
pkg install -y python nodejs git zip
DIR="$HOME/kashmoni"
mkdir -p "$DIR"
SRC="$(cd "$(dirname "$0")" && pwd)/kashmoni_helper.py"
if [ -f "$SRC" ]; then cp "$SRC" "$DIR/"; fi
if [ ! -f "$DIR/kashmoni_helper.py" ]; then
  echo "Put kashmoni_helper.py next to this script and run it again."; exit 1
fi
# 'kashmoni' command starts the helper
cat > "$PREFIX/bin/kashmoni" <<EOS
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock 2>/dev/null || true
exec python3 "$DIR/kashmoni_helper.py" "\$@"
EOS
chmod +x "$PREFIX/bin/kashmoni"
echo
echo "== Done =="
echo "Start the helper any time by typing:   kashmoni"
echo "Your token (paste it in the app's Settings):"
python3 "$DIR/kashmoni_helper.py" --show-token
