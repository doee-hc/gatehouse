import { describe, expect, test } from "bun:test"
import {
  filterDoneWhenForExecutionTeam,
  isPortalPublishCriterion,
  sanitizeInnerBriefStrings,
} from "../src/missions/done-when-filter.ts"

describe("done-when-filter", () => {
  test("isPortalPublishCriterion detects portal publish wording", () => {
    expect(isPortalPublishCriterion("报告被发布到 Portal")).toBe(true)
    expect(isPortalPublishCriterion("将报告发布到 Portal（gatehouse_publish_blog）")).toBe(true)
    expect(isPortalPublishCriterion("文件存在: reports/a.html")).toBe(false)
  })

  test("filterDoneWhenForExecutionTeam removes publish criteria", () => {
    expect(
      filterDoneWhenForExecutionTeam([
        "文件存在: reports/a.html",
        "报告被发布到 Portal",
        "设计美观",
      ]),
    ).toEqual(["文件存在: reports/a.html", "设计美观"])
  })

  test("sanitizeInnerBriefStrings strips publish tasks from brief slices", () => {
    expect(
      sanitizeInnerBriefStrings([
        "保存至 reports/a.html",
        "将报告发布到 Portal（gatehouse_publish_blog）",
      ]),
    ).toEqual(["保存至 reports/a.html"])
  })
})
