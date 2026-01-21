#!/usr/bin/env bun
import * as p from "@clack/prompts";
import c from "picocolors";

async function main() {
  p.intro(c.bgCyan(c.black(" dot ")));
  p.outro("Coming soon");
}

main().catch(console.error);
