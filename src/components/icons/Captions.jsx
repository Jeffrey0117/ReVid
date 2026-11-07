import { Icon } from './Icon';

export const Captions = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <rect width="18" height="14" x="3" y="5" rx="2" ry="2" />
        <path d="M7 15h4M15 15h2M7 11h2M13 11h4" />
    </Icon>
);
