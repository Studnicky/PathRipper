import { NodeErrorBuilder } from '@studnicky/dagonizer';
import type { NodeErrorType } from '@studnicky/dagonizer';

import type { PipelinePageType } from '../types/PipelineState.js';
import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';

/**
 * Wraps an `Error` or string into a `NodeErrorType` so it can be passed
 * to `state.collectError()` without leaving the dagonizer type contract.
 */
export const toNodeError = (err: unknown, operation: string): NodeErrorType => {
  const error = err instanceof Error ? err : new Error(String(err));
  const code = (error as { code?: string }).code ?? error.constructor.name;
  return NodeErrorBuilder.from(code, error.message, operation, false, new Date().toISOString());
};

/** Lower-cases the input and replaces non `[a-z0-9-]` runs with single hyphens. */
export const toSlug = (raw: string): string => {
  const lower     = raw.toLowerCase();
  const replaced  = lower.replace(/[^a-z0-9-]+/g, '-');
  const collapsed = replaced.replace(/-+/g, '-');
  return collapsed.replace(/^-|-$/g, '');
};

/**
 * Derives a safe filename stem from a URL.
 *
 * Takes the path and query string, replaces `?`, `=`, `&`, `/`, `#` and other
 * non-safe characters with hyphens, collapses repeats, and trims edge hyphens.
 */
export const urlToFilename = (url: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return toSlug(url);
  }
  const path   = parsed.pathname.replace(/^\//, '');
  const search = parsed.search.replace(/^\?/, '');
  const raw    = search.length > 0 ? `${path}?${search}` : path;
  const slug   = raw.replace(/[/?=&#]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return slug.length > 0 ? slug : toSlug(url);
};

/** Returns the slug for a page, preferring URL-based derivation for absolute URLs and falling back to title. */
export const pageSlug = (page: PipelinePageType): string => {
  if (page.url.length > 0) {
    try {
      new URL(page.url);
      const slug = urlToFilename(page.url);
      if (slug.length > 0) return slug;
    } catch {
      // Fall through to title-based slug.
    }
  }
  const source = page.title.length > 0 ? page.title : page.url;
  const slug   = toSlug(source);
  if (slug.length === 0) {
    throw ExternalSchemaError.create('Cannot derive slug from empty page identifier', {
      metadata: { title: page.title, url: page.url },
    });
  }
  return slug;
};
