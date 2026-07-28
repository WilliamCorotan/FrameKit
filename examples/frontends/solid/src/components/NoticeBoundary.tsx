import { Show, type Accessor } from "solid-js";

type NoticeBoundaryProps = { error: Accessor<string | undefined>; success: Accessor<string | undefined> };

export function NoticeBoundary(props: NoticeBoundaryProps) {
  return <>
    <Show when={props.error()}>{(value) => <p class="notice error" role="alert">{value()}</p>}</Show>
    <Show when={props.success()}>{(value) => <p class="notice success" role="status">{value()}</p>}</Show>
  </>;
}
