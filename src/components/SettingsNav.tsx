import { Show } from "solid-js";
import { A } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";

/**
 * Header bar shared by the settings pages (Entities, Members): back arrow,
 * page title + active-org badge, and a cross-link to the other settings page.
 */
export function SettingsNav(props: {
  title: string;
  orgName: string | undefined;
  crossLink: { href: string; label: string; icon: string };
}) {
  return (
    <nav class="min-h-12 px-4 flex items-center justify-between bg-surface border-b border-hairline">
      <div class="flex items-center gap-2 text-sm">
        <A href="/" class="flex items-center text-neutral-500 hover:text-neutral-800 p-1">
          <Icon icon="iconoir:arrow-left" width="16" />
        </A>
        <span class="font-medium text-neutral-800">{props.title}</span>
        <Show when={props.orgName}>
          <span class="bg-muted text-neutral-500 text-xs py-0.5 px-1.5 rounded">
            {props.orgName}
          </span>
        </Show>
      </div>
      <A
        href={props.crossLink.href}
        class="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800"
      >
        <Icon icon={props.crossLink.icon} width="14" /> {props.crossLink.label}
      </A>
    </nav>
  );
}
