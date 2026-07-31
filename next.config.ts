import type { NextConfig } from "next";

const isGitHubPagesBuild = process.env.GITHUB_PAGES === "true";
const repositoryName =
  process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "multi-video-player";
const pagesBasePath = repositoryName.endsWith(".github.io")
  ? ""
  : `/${repositoryName}`;

const nextConfig: NextConfig = {
  output: isGitHubPagesBuild ? "export" : undefined,
  trailingSlash: isGitHubPagesBuild,
  basePath: isGitHubPagesBuild ? pagesBasePath : undefined,
  assetPrefix: isGitHubPagesBuild ? pagesBasePath : undefined,
};

export default nextConfig;
