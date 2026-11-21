# Lab toolchain env — the Rust toolchain lives INSIDE this lab folder
# (installed by rustup-init with RUSTUP_HOME/CARGO_HOME pointed here), so
# nothing is written to the user's home directory and the app repo stays
# untouched. Source this file before any cargo command:
#   . ./env.sh
export RUSTUP_HOME="/home/z/my-project/rust-anything-lab/toolchain/rustup"
export CARGO_HOME="/home/z/my-project/rust-anything-lab/toolchain/cargo"
export PATH="$CARGO_HOME/bin:$PATH"
