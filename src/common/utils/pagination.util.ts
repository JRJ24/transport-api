import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../constants/pagination.constant';
import type { PaginatedResult } from '../interfaces/pagination.interface';

export interface PageParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function resolvePageParams(query: {
  page?: number;
  pageSize?: number;
}): PageParams {
  const page = Math.max(query.page ?? DEFAULT_PAGE, 1);
  const pageSize = Math.min(
    Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function toPaginatedResult<T>(
  items: T[],
  totalItems: number,
  params: Pick<PageParams, 'page' | 'pageSize'>,
): PaginatedResult<T> {
  return {
    items,
    page: params.page,
    pageSize: params.pageSize,
    totalItems,
    totalPages: Math.max(Math.ceil(totalItems / params.pageSize), 1),
  };
}
