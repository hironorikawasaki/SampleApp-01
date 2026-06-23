// 出退勤は店舗Padのキオスク打刻に一本化したため、個人端末での打刻ページは廃止。
// 旧URLは確認画面（/my-schedule）へリダイレクトする。
import { redirect } from "next/navigation";

export default function AttendanceRemoved() {
  redirect("/my-schedule");
}
