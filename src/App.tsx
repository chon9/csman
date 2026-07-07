import { useState } from 'react';
import { useGame } from './store/gameStore';
import { useOnline } from './online/onlineStore';
import ConnectScreen from './online/screens/ConnectScreen';
import CreateTeamScreen from './online/screens/CreateTeamScreen';
import OnlineHomeScreen from './online/screens/OnlineHomeScreen';
import OnlineMarketScreen from './online/screens/OnlineMarketScreen';
import OnlineChallengesScreen from './online/screens/OnlineChallengesScreen';
import OnlineHistoryScreen from './online/screens/OnlineHistoryScreen';
import OnlineMatchViewer from './online/screens/OnlineMatchViewer';
import OnlineTacticsScreen from './online/screens/OnlineTacticsScreen';
import OnlineLeaderboardScreen from './online/screens/OnlineLeaderboardScreen';
import OnlineTournamentsScreen from './online/screens/OnlineTournamentsScreen';
import OnlineLiveReplayScreen from './online/screens/OnlineLiveReplayScreen';
import OnlineAdminScreen from './online/screens/OnlineAdminScreen';
import OnlineCasesScreen from './online/screens/OnlineCasesScreen';
import OnlineBoostersScreen from './online/screens/OnlineBoostersScreen';
import OnlineMassageScreen from './online/screens/OnlineMassageScreen';
import OnlineMiniGamesScreen from './online/screens/OnlineMiniGamesScreen';
import OnlineScoutScreen from './online/screens/OnlineScoutScreen';
import OnlineStreamScreen from './online/screens/OnlineStreamScreen';
import AiBettingScreen from './online/screens/AiBettingScreen';
import RealEstateScreen from './online/screens/RealEstateScreen';
import EWalletScreen from './online/screens/EWalletScreen';
import DailyRaceScreen from './online/screens/DailyRaceScreen';
import OnlineTrainingScreen from './online/screens/TrainingScreen';
import OnlineInboxScreen from './online/screens/InboxScreen';
import MobileNav from './online/screens/MobileNav';
import FabDock from './online/screens/FabDock';
import OnlineSidebar from './online/screens/OnlineSidebar';
import ChatWidget from './online/screens/ChatWidget';
import DevReportModal from './online/screens/DevReportModal';
import LiveFeedWidget from './online/screens/LiveFeedWidget';
import TeamProfileModal from './online/screens/TeamProfileModal';
import PlayerProfileModal from './online/screens/PlayerProfileModal';
import WatchPromptModal from './online/screens/WatchPromptModal';
import Sidebar from './ui/Sidebar';
import TopBar from './ui/TopBar';
import MatchDayScreen from './ui/match/MatchDayScreen';
import NewGameScreen from './ui/screens/NewGameScreen';
import SplashScreen from './ui/screens/SplashScreen';
import MainMenu from './ui/screens/MainMenu';
import LoadSaveScreen from './ui/screens/LoadSaveScreen';
import HomeScreen from './ui/screens/HomeScreen';
import SquadScreen from './ui/screens/SquadScreen';
import PlayerProfile from './ui/screens/PlayerProfile';
import TacticsScreen from './ui/screens/TacticsScreen';
import ScheduleScreen from './ui/screens/ScheduleScreen';
import TournamentScreen from './ui/screens/TournamentScreen';
import TransfersScreen from './ui/screens/TransfersScreen';
import TrainingScreen from './ui/screens/TrainingScreen';
import StaffScreen from './ui/screens/StaffScreen';
import NewsScreen from './ui/screens/NewsScreen';
import FinancesScreen from './ui/screens/FinancesScreen';
import RankingsScreen from './ui/screens/RankingsScreen';
import ScoutingScreen from './ui/screens/ScoutingScreen';
import InboxScreen from './ui/screens/InboxScreen';
import HistoryScreen from './ui/screens/HistoryScreen';
import ManagerScreen from './ui/screens/ManagerScreen';
import HallOfFameScreen from './ui/screens/HallOfFameScreen';
import TeamProfile from './ui/screens/TeamProfile';
import CasesScreen from './ui/screens/CasesScreen';
import SportsbookScreen from './ui/screens/SportsbookScreen';
import ModManager from './ui/screens/ModManager';
import type { Screen } from './store/gameStore';

function ScreenContent({ screen }: { screen: Screen }) {
  switch (screen) {
    case 'home':
      return <HomeScreen />;
    case 'squad':
      return <SquadScreen />;
    case 'tactics':
      return <TacticsScreen />;
    case 'schedule':
      return <ScheduleScreen />;
    case 'rankings':
      return <RankingsScreen />;
    case 'tournament':
      return <TournamentScreen />;
    case 'transfers':
      return <TransfersScreen />;
    case 'training':
      return <TrainingScreen />;
    case 'staff':
      return <StaffScreen />;
    case 'news':
      return <NewsScreen />;
    case 'finances':
      return <FinancesScreen />;
    case 'scouting':
      return <ScoutingScreen />;
    case 'inbox':
      return <InboxScreen />;
    case 'matchday':
      return <MatchDayScreen />;
    case 'player':
      return <PlayerProfile />;
    case 'history':
      return <HistoryScreen />;
    case 'manager':
      return <ManagerScreen />;
    case 'halloffame':
      return <HallOfFameScreen />;
    case 'cases':
      return <CasesScreen />;
    case 'sportsbook':
      return <SportsbookScreen />;
    case 'teamprofile':
      return <TeamProfile />;
    case 'mods':
      return <ModManager />;
    default:
      return <HomeScreen />;
  }
}

type MenuPhase = 'splash' | 'menu' | 'new-career' | 'load-save' | 'online';

export default function App() {
  const game = useGame((s) => s.game);
  const screen = useGame((s) => s.screen);
  const onlineScreen = useOnline((s) => s.screen);
  const onlineDisconnect = useOnline((s) => s.disconnect);
  const [menuPhase, setMenuPhase] = useState<MenuPhase>('splash');

  if (menuPhase === 'online') {
    // Online mode owns the whole shell — different store, different routing.
    if (onlineScreen === 'connect') {
      return (
        <ConnectScreen
          onBack={() => {
            onlineDisconnect();
            setMenuPhase('menu');
          }}
        />
      );
    }
    // Pre-team flow: no chat / dev report yet (no session).
    if (onlineScreen === 'create-team') return <CreateTeamScreen />;
    // Everything past creation gets the chat widget + dev report overlays.
    let body: React.ReactNode;
    if (onlineScreen === 'market') body = <OnlineMarketScreen />;
    else if (onlineScreen === 'challenges') body = <OnlineChallengesScreen />;
    else if (onlineScreen === 'history') body = <OnlineHistoryScreen />;
    else if (onlineScreen === 'viewer') body = <OnlineMatchViewer />;
    else if (onlineScreen === 'tactics') body = <OnlineTacticsScreen />;
    else if (onlineScreen === 'leaderboard') body = <OnlineLeaderboardScreen />;
    else if (onlineScreen === 'tournaments') body = <OnlineTournamentsScreen />;
    else if (onlineScreen === 'replay') body = <OnlineLiveReplayScreen />;
    else if (onlineScreen === 'admin') body = <OnlineAdminScreen />;
    else if (onlineScreen === 'cases') body = <OnlineCasesScreen />;
    else if (onlineScreen === 'boosters') body = <OnlineBoostersScreen />;
    else if (onlineScreen === 'massage') body = <OnlineMassageScreen />;
    else if (onlineScreen === 'mini-games') body = <OnlineMiniGamesScreen />;
    else if (onlineScreen === 'scout') body = <OnlineScoutScreen />;
    else if (onlineScreen === 'streaming') body = <OnlineStreamScreen />;
    else if (onlineScreen === 'ai-bets') body = <AiBettingScreen />;
    else if (onlineScreen === 'real-estate') body = <RealEstateScreen />;
    else if (onlineScreen === 'ewallet') body = <EWalletScreen />;
    else if (onlineScreen === 'daily-race') body = <DailyRaceScreen />;
    else if (onlineScreen === 'training') body = <OnlineTrainingScreen />;
    else if (onlineScreen === 'inbox') body = <OnlineInboxScreen />;
    else body = <OnlineHomeScreen />;
    return (
      <div className="online-layout">
        <OnlineSidebar />
        <div className="online-layout-body">
          {body}
        </div>
        {/* Mobile-only bottom app bar + drawer. CSS hides on desktop. */}
        <MobileNav />
        {/* OnlineHomeScreen renders these locally — these cover the other screens. */}
        {onlineScreen !== 'home' && <ChatWidget />}
        {onlineScreen !== 'home' && <DevReportModal />}
        {onlineScreen !== 'home' && <LiveFeedWidget />}
        {onlineScreen !== 'home' && <FabDock />}
        {/* Team-profile modal lives at the shell level so any clickable
            team tag on any screen can open it. */}
        <TeamProfileModal />
        <PlayerProfileModal />
        {/* Confirm modal for Quick Match / accepted-challenge results —
            rendered at shell level so it interrupts any screen. */}
        <WatchPromptModal />
      </div>
    );
  }

  if (!game) {
    if (menuPhase === 'splash') return <SplashScreen onDone={() => setMenuPhase('menu')} />;
    if (menuPhase === 'new-career') return <NewGameScreen onBack={() => setMenuPhase('menu')} />;
    if (menuPhase === 'load-save') return <LoadSaveScreen onBack={() => setMenuPhase('menu')} />;
    return (
      <MainMenu
        onNewCareer={() => setMenuPhase('new-career')}
        onLoadSelected={() => setMenuPhase('load-save')}
        onOnline={() => setMenuPhase('online')}
      />
    );
  }

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <TopBar />
        <div className="content">
          <ScreenContent screen={screen} />
        </div>
      </div>
    </div>
  );
}
