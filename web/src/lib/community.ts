/** Public AniBT destinations shared by the shell, overview and guide. */
export const communityServices = [
  {
    id: "anime",
    href: "https://anibt.net/",
    title: "community.serviceAnime",
    description: "community.serviceAnimeDesc",
  },
  {
    id: "subtitles",
    href: "/",
    title: "community.workshop",
    description: "community.serviceSubtitlesDesc",
  },
  {
    id: "wiki",
    href: "https://wiki.anibt.net/",
    title: "community.serviceWiki",
    description: "community.serviceWikiDesc",
  },
  {
    id: "tracker",
    href: "https://tracker.anibt.net/",
    title: "community.serviceTracker",
    description: "community.serviceTrackerDesc",
  },
] as const;

export const communityLinks = {
  home: "https://anibt.net/",
  telegram: "https://t.me/anibtass",
  source: "https://github.com/Yuri-NagaSaki/FontInAss",
  releases: "https://github.com/Yuri-NagaSaki/FontInAss/releases/latest",
} as const;
