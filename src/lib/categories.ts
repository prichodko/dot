export interface Category {
  name: string;
  files: string[];
}

export const categories: Category[] = [
  {
    name: "Shell",
    files: [
      ".zshrc",
      ".zshenv",
      ".zprofile",
      ".bashrc",
      ".bash_profile",
      ".aliases",
    ],
  },
  {
    name: "Git",
    files: [".gitconfig", ".gitignore"],
  },
  {
    name: "Claude",
    files: [".claude"],
  },
  {
    name: "Apps",
    files: [".config/zed", ".config/karabiner"],
  },
  {
    name: "SSH",
    files: [".ssh/config"],
  },
];

export function getCategoryForFile(file: string): string | undefined {
  for (const cat of categories) {
    if (cat.files.some((f) => file === f || file.startsWith(f + "/"))) {
      return cat.name;
    }
  }
  return undefined;
}

export function getAllFiles(): string[] {
  return categories.flatMap((c) => c.files);
}
