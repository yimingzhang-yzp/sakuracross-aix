/** Server Action の共通戻り値(useActionState 用) */
export interface ActionState {
  error?: string;
  success?: string;
}

export const initialActionState: ActionState = {};
