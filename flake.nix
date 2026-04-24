{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
          };
        };
      in
      with pkgs;
      {
        devShells.default = mkShell {
          buildInputs = [
            nodejs_24
            pnpm
            # nixos can't deal with statically linked binaries, so
            # we need to use nix packages rather than the npm prebuilts
            oxlint
            oxfmt
          ];
        };
      }
    );
}
