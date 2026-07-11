export type Teacher = {
  id: string;
  name: string;
  display_name?: string | null;
  subject?: string | null;
  is_active?: boolean;
};

export type ClassItem = {
  id: string;
  name: string;
  grade?: string | null;
  day_pattern?: string | null;
  is_active?: boolean;
};

export type EvaluationPeriod = {
  id: string;
  year_month: string;
  title: string;
  start_date?: string | null;
  end_date?: string | null;
  status: "draft" | "open" | "closed" | "archived";
};

export type EvaluationQuestion = {
  id: string;
  code: string;
  category: "academy" | "fairness" | "teacher" | "comment";
  question_type: "scale_5" | "yes_no" | "text";
  title: string;
  help_text?: string | null;
  display_order: number;
  is_required: boolean;
  is_score_target: boolean;
  metadata?: any;
};

export type QrLink = {
  id: string;
  token: string;
  title?: string | null;
  is_active: boolean;
  response_count: number;
  teachers?: Teacher;
  classes?: ClassItem;
  evaluation_periods?: EvaluationPeriod;
  teacher_id: string;
  class_id?: string | null;
  evaluation_period_id: string;
};

export type ResponseRow = {
  id: string;
  student_name: string;
  submitted_at: string;
  is_flagged: boolean;
  flag_reason?: string | null;
  teachers?: Teacher;
  classes?: ClassItem;
  evaluation_answers?: any[];
};
