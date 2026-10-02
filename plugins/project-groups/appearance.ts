export const ICON_COLORS = [
  "#e5e7eb", "#ff6464", "#ff8747", "#ffd43b",
  "#38c878", "#3298f5", "#a874f7", "#f783b7",
] as const;

export const ICONS = [
  ["Folder", "Folder"], ["CircleDollarSign", "Money"], ["BookOpen", "Book"],
  ["GraduationCap", "Education"], ["Pencil", "Writing"], ["PenTool", "Design"],
  ["Braces", "Code"], ["SquareTerminal", "Terminal"], ["Music2", "Music"],
  ["Popcorn", "Entertainment"], ["Atom", "Science"], ["Palette", "Art"],
  ["Stethoscope", "Health"], ["Asterisk", "General"], ["Flower2", "Nature"],
  ["BriefcaseBusiness", "Work"], ["ChartNoAxesColumn", "Chart"],
  ["Dumbbell", "Fitness"], ["NotebookPen", "Notes"], ["Scale", "Law"],
  ["Globe2", "World"], ["Plane", "Travel"], ["Globe", "Internet"],
  ["Wrench", "Tools"], ["PawPrint", "Animals"], ["FlaskConical", "Lab"],
  ["Brain", "Ideas"], ["Heart", "Personal"], ["Gift", "Gift"],
] as const;
export const ICON_NAMES = ICONS.map(([name]) => name) as [string, ...string[]];

export const EMOJIS = [
  ["📁", "Folder"], ["💼", "Work"], ["💰", "Money"], ["📚", "Books"],
  ["🎓", "Education"], ["✏️", "Writing"], ["💻", "Code"], ["🎵", "Music"],
  ["🎨", "Art"], ["🧪", "Science"], ["🩺", "Health"], ["🌿", "Nature"],
  ["🏋️", "Fitness"], ["⚖️", "Law"], ["🌍", "World"], ["✈️", "Travel"],
  ["🔧", "Tools"], ["🐾", "Animals"], ["🧠", "Ideas"], ["❤️", "Personal"],
  ["🎁", "Gift"], ["⭐", "Star"], ["🚀", "Launch"], ["🗂️", "Projects"],
] as const;
