{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.05";
    flake-utils.url = "github:numtide/flake-utils";
    nixpkgs-unstable.url = "github:nixos/nixpkgs/nixos-unstable";
  };

  outputs =
    {
      self,
      nixpkgs,
      nixpkgs-unstable,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        stable = nixpkgs.legacyPackages.${system};
        unstable = nixpkgs-unstable.legacyPackages.${system};
        nodejs = stable.nodejs_22;
        corepackEnable = stable.runCommand "corepack-enable" { } ''
          mkdir -p $out/bin
          ${nodejs}/bin/corepack enable --install-directory $out/bin
        '';
      in
      {
        devShells = {
          default =
            with stable;
            mkShell {
              BIOME_BINARY = "${unstable.biome}/bin/biome";
              buildInputs = [
                # see https://github.com/biomejs/biome-vscode/issues/295
                # nixos can't deal with statically linked binaries, so
                # we need to use the biome nix package
                unstable.biome
                nodejs
                sqlite
                corepackEnable
              ];
            };
        };
      }
    );
}
