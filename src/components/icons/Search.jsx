import { Icon } from './Icon';

export const Search = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
    </Icon>
);
