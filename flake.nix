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
      {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_24
            pkgs.just
            pkgs.sqlite
            (
              let
                packageManager =
                  (builtins.fromJSON (builtins.readFile ./package.json)).packageManager;
                pnpmVersion = builtins.head (
                  pkgs.lib.splitString "+" (pkgs.lib.removePrefix "pnpm@" packageManager)
                );
                pnpmLinuxPlatform = builtins.getAttr system {
                  "aarch64-linux" = {
                    asset = "linux-arm64-musl";
                    hash = "sha256-URpUgJvf0oJw0wAR0Wl/WCyBMNVVtPoOKFaxp1NMmL8=";
                  };
                  "x86_64-linux" = {
                    asset = "linux-x64-musl";
                    hash = "sha256-1xFeLyeR15v55+RIYJU3WVu3eH3h71KSzpH/PRviYp4=";
                  };
                };
              in
              if pkgs.stdenv.hostPlatform.isLinux then
                pkgs.stdenvNoCC.mkDerivation {
                  pname = "pnpm";
                  version = pnpmVersion;

                  src = pkgs.fetchurl {
                    url =
                      "https://github.com/pnpm/pnpm/releases/download/"
                      + "v${pnpmVersion}/pnpm-${pnpmLinuxPlatform.asset}.tar.gz";
                    inherit (pnpmLinuxPlatform) hash;
                  };

                  sourceRoot = ".";
                  dontBuild = true;
                  dontConfigure = true;

                  installPhase = ''
                    runHook preInstall

                    install -Dm755 pnpm $out/bin/pnpm
                    ln -s pnpm $out/bin/pn
                    ln -s pnpm $out/bin/pnpx
                    ln -s pnpm $out/bin/pnx

                    runHook postInstall
                  '';
                }
              else
                pkgs.pnpm
            )
          ];
        };
      }
    );
}
