import { invoke } from "@tauri-apps/api/core";

export type FieldType = "text" | "email" | "tel" | "textarea" | "select" | "radio" | "checkboxes" | "checkbox";

/** Field types by group, in the order the type menu shows them. */
export const FIELD_TYPE_GROUPS: { label: string; types: { type: FieldType; label: string }[] }[] = [
  {
    label: "入力欄",
    types: [
      { type: "text", label: "1 行のテキスト" },
      { type: "email", label: "メールアドレス" },
      { type: "tel", label: "電話番号" },
      { type: "textarea", label: "複数行のテキスト" },
    ],
  },
  {
    label: "選択肢から選ぶ",
    types: [
      { type: "select", label: "プルダウン（1 つ選ぶ）" },
      { type: "radio", label: "ラジオボタン（1 つ選ぶ）" },
      { type: "checkboxes", label: "チェックボックス（いくつでも選ぶ）" },
    ],
  },
  {
    label: "同意",
    types: [{ type: "checkbox", label: "同意のチェック（1 つ）" }],
  },
];

export const FIELD_TYPES = FIELD_TYPE_GROUPS.flatMap((g) => g.types);

/** Types that pick from `options`. */
export const hasOptions = (type: FieldType) => type === "select" || type === "radio" || type === "checkboxes";

export type FormField = { id: string; label: string; type: FieldType; required: boolean; options?: string[] };

export type Form = {
  id: number;
  name: string;
  fields: FormField[];
  submit_label: string | null;
  success_message: string | null;
  pages: { id: number; title: string }[];
  submissions: number;
  unread: number;
};

export type FormInput = Pick<Form, "name" | "fields" | "submit_label" | "success_message"> & { id: number | null };

export type Submission = {
  id: number;
  form_id: number;
  data: { label: string; value: string }[] | null;
  page_path: string | null;
  created_at: string;
  read_at: string | null;
};

export type Inbox = { unread: number; latest_id: number | null };

/** Permission the token needs for forms, as shown on the token page. */
export const FORMS_PERMISSION = "Account · Turnstile · Edit";

export const formsStatus = () => invoke<{ enabled: boolean }>("forms_status");
export const enableForms = () => invoke<"enabled" | "permission">("forms_enable");
/** Resolves to a warning when the Turnstile widget couldn't be deleted. */
export const disableForms = () => invoke<string | null>("forms_disable");
export const listForms = () => invoke<Form[]>("forms_list");
export const saveForm = (input: FormInput) => invoke<number>("form_save", { input });
export const deleteForm = (id: number) => invoke<void>("form_delete", { id });
export const listSubmissions = (formId: number, limit = 200) =>
  invoke<Submission[]>("submissions_list", { formId, limit });
export const setSubmissionRead = (id: number, read: boolean) => invoke<void>("submission_set_read", { id, read });
export const deleteSubmission = (id: number) => invoke<void>("submission_delete", { id });
export const pollSubmissions = (seenId: number | null) => invoke<Inbox>("submissions_poll", { seenId });

/** A short random ID for a new field (the input name is `f_<id>`). */
export const newFieldId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);

export const defaultFields = (): FormField[] => [
  { id: newFieldId(), label: "お名前", type: "text", required: true },
  { id: newFieldId(), label: "メールアドレス", type: "email", required: true },
  {
    id: newFieldId(),
    label: "お問い合わせの種類",
    type: "radio",
    required: true,
    options: ["サービスについて", "お見積もりのご依頼", "その他"],
  },
  { id: newFieldId(), label: "お問い合わせ内容", type: "textarea", required: true },
];
