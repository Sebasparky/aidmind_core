/**
 * User Switcher for Mock RBAC Testing
 */

import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { MockUser, MOCK_USERS, ROLE_DISPLAY_NAMES, ROLE_COLORS } from "@/lib/rbac/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface UserSwitcherProps {
  currentUser: MockUser | null;
}

export function UserSwitcher({ currentUser }: UserSwitcherProps) {
  const { switchUser } = useAuth();
  const navigate = useNavigate();

  const handleSwitchUser = (userId: string) => {
    switchUser(userId);
    const user = Object.values(MOCK_USERS).find((u) => u.id === userId);
    if (user) {
      if (user.role === "auditor") {
        navigate("/auditor");
      } else if (user.role === "supervisor") {
        navigate("/supervisor");
      } else {
        navigate("/dashboard");
      }
    }
  };

  if (!currentUser) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-xs font-medium text-primary-foreground">
            {currentUser.initials}
          </div>
          <div className="text-left">
            <div className="text-sm font-medium">{currentUser.name}</div>
            <div className="text-xs text-muted-foreground">
              {ROLE_DISPLAY_NAMES[currentUser.role]}
            </div>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          Switch User (Dev Only)
        </DropdownMenuLabel>
        {Object.values(MOCK_USERS).map((user) => (
          <DropdownMenuItem
            key={user.id}
            onClick={() => handleSwitchUser(user.id)}
            className={cn(
              "flex items-center justify-between cursor-pointer",
              user.id === currentUser.id && "bg-muted"
            )}
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                {user.initials}
              </div>
              <span>{user.name}</span>
            </div>
            <Badge 
              variant="outline" 
              className={cn("text-xs", ROLE_COLORS[user.role])}
            >
              {user.role}
            </Badge>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
