import type { ArticleFormat } from "../../shared/editor-contract";

const PRETTIER_OPTIONS = {
  printWidth: 100,
  proseWrap: "preserve" as const,
  tabWidth: 2,
  useTabs: false,
  endOfLine: "lf" as const,
};

/** Formats a complete Markdown/MDX document through Prettier's syntax tree. */
export async function formatMarkdown(
  source: string,
  format: ArticleFormat = "md",
): Promise<string> {
  const [prettier, markdownPlugin, babelPlugin, estreePlugin] = await Promise.all([
    import("prettier/standalone"),
    import("prettier/plugins/markdown"),
    import("prettier/plugins/babel"),
    import("prettier/plugins/estree"),
  ]);

  return prettier.format(source, {
    ...PRETTIER_OPTIONS,
    parser: format === "mdx" ? "mdx" : "markdown",
    plugins: [markdownPlugin.default, babelPlugin.default, estreePlugin.default],
  });
}
