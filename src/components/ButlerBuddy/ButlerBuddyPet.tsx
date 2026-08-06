import { Circle } from "lucide-react";

const petImageUrl = `${import.meta.env.BASE_URL}butlerbuddy-pet.png`;

export function ButlerBuddyPet() {
  return (
    <div className="butler-pet-surface" aria-label="ButlerBuddy floating companion">
      <div className="butler-pet-drag-zone" aria-hidden="true" />
      <button
        type="button"
        className="butler-pet-button"
        aria-label="打开 ButlerBuddy 对话"
        title="ButlerBuddy"
        onClick={() => window.freebuddy?.butlerBuddy?.toggleChat()}
      >
        <img src={petImageUrl} alt="" draggable={false} />
        <Circle
          className="butler-pet-online"
          size={12}
          strokeWidth={3}
          fill="currentColor"
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
