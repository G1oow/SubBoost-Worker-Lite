import { REPOSITORY_RELEASES_URL, REPOSITORY_URL } from "@subboost/server-core/repository";

/**
 * 外部链接入口。
 *
 * 管理端要给用户几个明确去处，所以地址集中在这里。仓库地址本身来自
 * `@subboost/server-core/repository`：Worker 的新版本检测与管理端用的是同一份常量，
 * 换仓库时不会出现两边不一致。
 */
export { REPOSITORY_RELEASES_URL, REPOSITORY_URL };

/** age 加密订阅的部署与使用文档 */
export const AGE_ENCRYPTION_DOC_URL = `${REPOSITORY_URL}/blob/main/docs/age-encryption.md`;
