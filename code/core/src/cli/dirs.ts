import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

import {
  frameworkPackages,
  rendererPackages,
  temporaryDirectory,
  versions,
} from 'storybook/internal/common';
import type { JsPackageManager } from 'storybook/internal/common';
import type { SupportedFramework } from 'storybook/internal/types';
import { type SupportedRenderer } from 'storybook/internal/types';

import { unpackTar } from 'modern-tar/fs';
import invariant from 'tiny-invariant';

import { resolvePackageDir } from '../shared/utils/module.ts';

const resolveUsingBranchInstall = async (packageManager: JsPackageManager, request: string) => {
  const tempDirectory = await temporaryDirectory();
  const name = request as keyof typeof versions;

  // FIXME: this might not be the right version for community packages
  const version = versions[name] || (await packageManager.latestVersion(request));

  const stdout = await packageManager.executeCommand({
    command: 'npm',
    args: ['pack', `${request}@${version}`, '--pack-destination', tempDirectory, '--silent'],
  });

  const tarballFilename = stdout.trim().split('\n').pop()?.trim();
  invariant(tarballFilename, `Failed to download tarball for ${request}@${version}`);

  // this unzips the tarball into the temp directory
  await pipeline(
    createReadStream(join(tempDirectory, tarballFilename)),
    createGunzip(),
    unpackTar(tempDirectory)
  );

  return join(tempDirectory, 'package');
};

export async function getRendererDir(
  packageManager: JsPackageManager,
  renderer: SupportedFramework | SupportedRenderer
) {
  const [externalFramework] =
    Object.entries({ ...frameworkPackages, ...rendererPackages }).find(
      ([key, value]) => value === renderer
    ) ?? [];

  if (!externalFramework) {
    return null;
  }

  const packageJsonPath = join(externalFramework, 'package.json');

  const errors: Error[] = [];

  try {
    return resolvePackageDir(externalFramework, process.cwd());
  } catch (e) {
    invariant(e instanceof Error);
    errors.push(e);
  }

  try {
    return await resolveUsingBranchInstall(packageManager, externalFramework);
  } catch (e) {
    invariant(e instanceof Error);
    errors.push(e);
  }

  throw new Error(`Cannot find ${packageJsonPath}, ${errors.map((e) => e.stack).join('\n\n')}`);
}
