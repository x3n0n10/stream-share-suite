// web/src/pages/stack/ComponentsTab.jsx
import GluetunCard from "./GluetunCard.jsx";
import PostgresCard from "./PostgresCard.jsx";
import CaddyCard from "./CaddyCard.jsx";

const CARD_BY_KIND = {
  gluetun: GluetunCard,
  postgres: PostgresCard,
  caddy: CaddyCard,
};

// Instances have their own tab — this only ever renders the three
// singleton components (gluetun/postgres/caddy).
export default function ComponentsTab({
  components,
  settings,
  onSaveSettings,
  busy,
  onSaved,
  plan,
  onApplyTakeover,
  onPull,
}) {
  return (
    <div className="flex flex-col gap-4">
      {components
        .filter((component) => component.kind !== "instance")
        .map((component) => {
          const CardComponent = CARD_BY_KIND[component.kind];
          if (!CardComponent) return null;
          const takeoverAvailable =
            plan?.plans.some((row) => row.kind === component.kind && row.action === "adopt") || false;
          return (
            <CardComponent
              key={component.kind}
              component={component}
              settings={settings}
              onSaveSettings={onSaveSettings}
              busy={busy}
              onSaved={onSaved}
              takeoverAvailable={takeoverAvailable}
              onApplyTakeover={() => onApplyTakeover(component.kind)}
              onPull={() => onPull(component.kind)}
            />
          );
        })}
    </div>
  );
}
