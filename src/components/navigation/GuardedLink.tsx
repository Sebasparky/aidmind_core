import React from 'react';
import { Link, LinkProps } from 'react-router-dom';
import { useNavigationGuard } from '@/contexts/NavigationGuardContext';

interface GuardedLinkProps extends Omit<LinkProps, 'to'> {
  to: string;
  children: React.ReactNode;
}

export function GuardedLink({ to, children, onClick, ...props }: GuardedLinkProps) {
  const { guardActive, guardedNavigate } = useNavigationGuard();

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (guardActive) {
      e.preventDefault();
      guardedNavigate(to);
    } else if (onClick) {
      onClick(e);
    }
  };

  return (
    <Link to={to} onClick={handleClick} {...props}>
      {children}
    </Link>
  );
}
