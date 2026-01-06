import React, { forwardRef } from "react";
import { Link, LinkProps } from "react-router-dom";
import { useNavigationGuard } from "@/contexts/NavigationGuardContext";

interface GuardedLinkProps extends Omit<LinkProps, "to"> {
  to: string;
  children: React.ReactNode;
}

export const GuardedLink = forwardRef<HTMLAnchorElement, GuardedLinkProps>(
  ({ to, children, onClick, ...props }, ref) => {
    const { guardActive, guardedNavigate } = useNavigationGuard();

    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented) return;

      if (guardActive) {
        e.preventDefault();
        guardedNavigate(to);
      }
    };

    return (
      <Link ref={ref} to={to} onClick={handleClick} {...props}>
        {children}
      </Link>
    );
  }
);

GuardedLink.displayName = "GuardedLink";
