#!/usr/bin/env python
"""Pack the extension into a .vsix (a zip) without node/npm/vsce.

A .vsix is a zip with:
  extension.vsixmanifest   — VS Code gallery manifest (XML)
  [Content_Types].xml      — MIME map
  extension/<files>        — the packaged extension (package.json must be here)

Run:  uv run python tools/build_vsix.py
"""
import json
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Files shipped inside extension/ (everything users need at runtime).
FILES = ["package.json", "extension.js", "quokka.ttf", "icon.png", "README.md", "LICENSE"]


def manifest(pkg):
    pub = pkg["publisher"]
    name = pkg["name"]
    ver = pkg["version"]
    disp = pkg.get("displayName", name)
    desc = pkg.get("description", "")
    return f"""<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="{name}" Version="{ver}" Publisher="{pub}" />
    <DisplayName>{disp}</DisplayName>
    <Description xml:space="preserve">{desc}</Description>
    <Tags>{",".join(pkg.get("keywords", []))}</Tags>
    <Categories>{",".join(pkg.get("categories", ["Other"]))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{pkg["engines"]["vscode"]}" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="{pkg.get("homepage", "")}" />
    </Properties>
    <Icon>extension/icon.png</Icon>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/icon.png" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
  </Assets>
</PackageManifest>
"""


CONTENT_TYPES = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="ttf" ContentType="application/font-sfnt" />
  <Default Extension="png" ContentType="image/png" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
</Types>
"""


def main():
    pkg = json.load(open(os.path.join(ROOT, "package.json"), encoding="utf-8"))
    out = os.path.join(ROOT, f'{pkg["publisher"]}.{pkg["name"]}-{pkg["version"]}.vsix')
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("extension.vsixmanifest", manifest(pkg))
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        for f in FILES:
            p = os.path.join(ROOT, f)
            if os.path.exists(p):
                z.write(p, "extension/" + f)
    print("wrote", out)


if __name__ == "__main__":
    main()
